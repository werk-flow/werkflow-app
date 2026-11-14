-- The office creates an offer for the right customer and recipient, and finds
-- it again (werk-flow/werkflow-planning#380).
--
-- 1. default_billing_recipient: the one home of E10's default recipient rule
--    (the Objekt's current Rechnungsempfänger, else the customer). The work
--    trigger of 20261203150001 and the offer's create call it.
-- 2. offers: the offer record without positions. A yearly number
--    ANG-<year>-<n>, a title, the customer (Auftraggeber) with an optional
--    Einsatzort and Ansprechpartner of that customer, the Rechnungsempfänger,
--    a validity date, opening and closing text, a responsible member and the
--    job, project or request it was written for. Only „Entwurf“ is written
--    here; the status check already names the states later children write, so
--    no column changes its meaning then. The recipient's name and address are
--    frozen when an offer is sent, not here.
-- 3. offer_events: the append-only history. Each row names its event, the
--    offer's status and version after it, and for a change each changed field
--    with its old and new value. Every write of an offer writes its event in
--    the same call. A retried call under the attempt key of an earlier event
--    answers with that call's result and writes nothing.
-- 4. create_offer: the office's write. list_offer_page and get_offer: the
--    server's reads. Changing the header follows in its own migration.
-- 5. client_links: a customer an offer names is linked and stays.
--
-- Division of work: the server actions in lib/offers/ establish identity, the
-- manager role and the organization, and pass them. Each write function checks
-- the actor's membership, role and effective access again under the access
-- lock, as app_private.lock_company_document_profile does.
--
-- Expand-only: new tables and functions; the replaced trigger function and
-- client_links keep their signatures and results.
--
-- Prevention: Tier 1 (constraints, the ledger guard, no client grant on the
-- history), Tier 2 supabase/tests/offers.sql and work_billing_parties.sql.

-- 1. The default recipient of a customer at an optional Objekt: the Objekt's
-- Rechnungsempfänger on today's Berlin date whose holder is not archived
-- (source objekt), else the customer itself (source auftraggeber).
create function app_private.default_billing_recipient(
  p_organization_id uuid,
  p_client_id uuid,
  p_site_id uuid,
  out recipient_client_id uuid,
  out source text
)
language plpgsql
stable
security invoker
set search_path to ''
as $$
begin
  if p_site_id is not null then
    select role.holder_client_id into recipient_client_id
    from public.client_site_roles role
    join public.clients holder
      on holder.id = role.holder_client_id and holder.organization_id = p_organization_id
    where role.organization_id = p_organization_id and role.site_id = p_site_id
      and role.role = 'rechnungsempfaenger' and holder.archived_at is null
      and (role.starts_on is null or role.starts_on <= (now() at time zone 'Europe/Berlin')::date)
      and (role.ends_on is null or role.ends_on >= (now() at time zone 'Europe/Berlin')::date);
  end if;
  source := case when recipient_client_id is null then 'auftraggeber' else 'objekt' end;
  recipient_client_id := coalesce(recipient_client_id, p_client_id);
end;
$$;
revoke all on function app_private.default_billing_recipient(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.default_billing_recipient(uuid, uuid, uuid) to service_role;

-- The work trigger of 20261203150001, with its recipient rule moved into the
-- function above. Every other step is as it was.
create or replace function app_private.keep_work_billing_parties()
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
  v_default record;
  v_actor_id uuid;
begin
  if new.client_id is null or not exists (
    select 1 from public.clients client
    where client.id = new.client_id and client.organization_id = new.organization_id
  ) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    v_current := app_private.current_work_billing_parties(new.organization_id, new.id);
    if old.client_id is not distinct from new.client_id and v_current.id is not null
      and v_current.source not in ('objekt', 'auftraggeber')
    then
      return null;
    end if;
  else
    v_actor_id := new.created_by;
  end if;

  if v_kind = 'service_case' and tg_op = 'INSERT' then
    if new.source_request_id is not null then
      v_carried := app_private.current_work_billing_parties(new.organization_id, new.source_request_id);
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
      v_carried := app_private.current_work_billing_parties(new.organization_id, new.project_id);
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

  v_default := app_private.default_billing_recipient(new.organization_id, new.client_id, new.site_id);
  perform app_private.record_work_billing_parties(new.organization_id, v_kind, new.id,
    new.client_id, v_default.recipient_client_id, v_default.source, null);
  return null;
end;
$$;
revoke all on function app_private.keep_work_billing_parties() from public, anon, authenticated;

-- 2. The offer record.
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offer_number text not null,
  title text not null,
  status text not null default 'entwurf',
  -- The Auftraggeber, whose Objekt and Ansprechpartner the offer names.
  client_id uuid not null,
  site_id uuid,
  contact_id uuid,
  -- The Rechnungsempfänger; true while it follows the default rule, so a
  -- changed customer or Objekt derives it again.
  recipient_client_id uuid not null,
  recipient_is_default boolean not null default true,
  valid_until date not null,
  opening_text text not null default '',
  closing_text text not null default '',
  -- The responsible member; null once the person's account is deleted.
  owner_user_id uuid references auth.users (id) on delete set null,
  -- The work it was written for, at most one; a deleted work clears it.
  request_id uuid,
  job_id uuid,
  project_id uuid,
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_number_unique unique (organization_id, offer_number),
  constraint offers_id_organization_key unique (id, organization_id),
  constraint offers_number_check check (offer_number ~ '^ANG-[0-9]{4}-[0-9]{3,}$'),
  constraint offers_title_check check (btrim(title) <> '' and char_length(title) <= 200),
  constraint offers_status_check check (
    status in ('entwurf', 'gesendet', 'angenommen', 'abgelehnt', 'zurueckgezogen')
  ),
  constraint offers_text_check check (
    char_length(opening_text) <= 4000 and char_length(closing_text) <= 4000
  ),
  constraint offers_one_work check (num_nonnulls(request_id, job_id, project_id) <= 1),
  constraint offers_version_check check (version >= 1),
  -- Every reference stays inside the organization; the Objekt belongs to the customer.
  constraint offers_client_fk foreign key (client_id, organization_id)
    references public.clients (id, organization_id),
  constraint offers_site_fk foreign key (site_id, client_id, organization_id)
    references public.client_sites (id, client_id, organization_id),
  constraint offers_contact_fk foreign key (contact_id, organization_id)
    references public.client_contacts (id, organization_id),
  constraint offers_recipient_fk foreign key (recipient_client_id, organization_id)
    references public.clients (id, organization_id),
  constraint offers_request_fk foreign key (request_id, organization_id)
    references public.client_requests (id, organization_id) on delete set null (request_id),
  constraint offers_job_fk foreign key (job_id, organization_id)
    references public.jobs (id, organization_id) on delete set null (job_id),
  constraint offers_project_fk foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete set null (project_id)
);

create unique index offers_replident_idx on public.offers (id, organization_id);
create index offers_organization_created_idx on public.offers (organization_id, created_at desc, id desc);
create index offers_client_idx on public.offers (client_id, organization_id);
create index offers_recipient_idx on public.offers (recipient_client_id, organization_id);
create index offers_site_idx on public.offers (site_id, client_id, organization_id) where site_id is not null;
create index offers_contact_idx on public.offers (contact_id, organization_id) where contact_id is not null;
create index offers_request_idx on public.offers (request_id, organization_id) where request_id is not null;
create index offers_job_idx on public.offers (job_id, organization_id) where job_id is not null;
create index offers_project_idx on public.offers (project_id, organization_id) where project_id is not null;
create index offers_owner_user_id_idx on public.offers (owner_user_id);
create index offers_created_by_idx on public.offers (created_by);
create index offers_updated_by_idx on public.offers (updated_by);

-- A manager's session reads the rows only to hear of a change; the server
-- reads and writes them. A field worker reads no offer.
alter table public.offers enable row level security;
create policy "Managers can view offers in their orgs" on public.offers
  for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
revoke all on table public.offers from public, anon, authenticated, service_role;
grant select on table public.offers to authenticated;
grant select, insert, update on table public.offers to service_role;

alter table public.offers replica identity using index offers_replident_idx;
alter publication supabase_realtime add table public.offers;
create trigger emit_realtime_deletion after delete on public.offers
  for each row execute function app_private.emit_realtime_deletion();

-- 3. The history.
create table public.offer_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offer_id uuid not null,
  -- created and changed here; later children add their own events.
  event_type text not null,
  -- The offer's status and version after the event.
  status text not null,
  version integer not null,
  -- A change: each changed field with its old and new value.
  payload jsonb not null default '{}',
  -- Null once the actor's account is deleted: the event stays, the person does not.
  actor_id uuid references auth.users (id) on delete set null,
  -- The call that wrote the event: a retry under the same key answers from it.
  attempt_key uuid not null,
  created_at timestamptz not null default now(),
  constraint offer_events_offer_fk foreign key (offer_id, organization_id)
    references public.offers (id, organization_id) on delete cascade,
  constraint offer_events_type_check check (event_type ~ '^[a-z][a-z_]{0,40}$'),
  constraint offer_events_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint offer_events_attempt_unique unique (organization_id, attempt_key)
);

create index offer_events_offer_idx on public.offer_events (offer_id, organization_id, created_at desc);
create index offer_events_actor_id_idx on public.offer_events (actor_id);

alter table public.offer_events enable row level security;
revoke all on table public.offer_events from public, anon, authenticated, service_role;
grant select, insert on table public.offer_events to service_role;

create trigger guard_event_ledger_history before update or delete on public.offer_events
  for each row execute function app_private.guard_event_ledger_history();

-- The actor is an Admin or Büro member of the organization whose access is
-- in effect. The access lifecycle's advisory lock, taken shared, lets no
-- suspension commit between this check and the caller's write, and the share
-- lock holds the membership until commit.
create function app_private.lock_office_actor(p_organization_id uuid, p_actor_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended(
    p_organization_id::text || ':p1-24-access:' || record.id::text, 0
  ))
  from public.employee_records record
  where record.organization_id = p_organization_id and record.user_id = p_actor_id;
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
    and member.role = any (array['admin'::public.org_role, 'buero'::public.org_role])
    and app_private.p1_24_has_effective_access(member.organization_id, member.user_id)
  for share;
  if not found then
    raise exception 'not_authorized';
  end if;
end;
$$;
revoke all on function app_private.lock_office_actor(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.lock_office_actor(uuid, uuid) to service_role;

-- The next yearly number, ANG-<Berlin year>-<at least three digits>. The
-- advisory lock serializes the organization's creates until commit.
create function app_private.next_offer_number(p_organization_id uuid)
returns text
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':offer-number', 0));
  select coalesce(max(substring(offer.offer_number from ('^ANG-' || v_year || '-([0-9]+)$'))::integer), 0) + 1
  into v_next
  from public.offers offer
  where offer.organization_id = p_organization_id
    and offer.offer_number ~ ('^ANG-' || v_year || '-[0-9]+$');
  return 'ANG-' || v_year || '-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
end;
$$;
revoke all on function app_private.next_offer_number(uuid) from public, anon, authenticated;
grant execute on function app_private.next_offer_number(uuid) to service_role;

-- Checks the customer and the Objekt, contact and work an offer names,
-- inside the organization. Refusals: client_not_found, client_archived,
-- site_not_found, contact_not_found, work_not_found (another customer's work too).
create function app_private.check_offer_references(
  p_organization_id uuid,
  p_client_id uuid,
  p_site_id uuid,
  p_contact_id uuid,
  p_work_kind text,
  p_work_id uuid
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_archived boolean;
  v_work_client_id uuid;
begin
  select client.archived_at is not null into v_archived from public.clients client
  where client.id = p_client_id and client.organization_id = p_organization_id
  for share;
  if not found then raise exception 'client_not_found'; end if;
  if v_archived then raise exception 'client_archived'; end if;
  if p_site_id is not null and not exists (
    select 1 from public.client_sites site
    where site.id = p_site_id and site.organization_id = p_organization_id and site.client_id = p_client_id
  ) then
    raise exception 'site_not_found';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.client_contacts contact
    where contact.id = p_contact_id and contact.organization_id = p_organization_id
      and contact.client_id = p_client_id
  ) then
    raise exception 'contact_not_found';
  end if;
  if p_work_kind is null then
    return;
  end if;
  if p_work_kind = 'job' then
    select job.client_id into v_work_client_id from public.jobs job
    where job.id = p_work_id and job.organization_id = p_organization_id for share;
  elsif p_work_kind = 'project' then
    select project.client_id into v_work_client_id from public.projects project
    where project.id = p_work_id and project.organization_id = p_organization_id for share;
  else
    select request.client_id into v_work_client_id from public.client_requests request
    where request.id = p_work_id and request.organization_id = p_organization_id for share;
  end if;
  if not found or v_work_client_id is distinct from p_client_id then
    raise exception 'work_not_found';
  end if;
end;
$$;
revoke all on function app_private.check_offer_references(uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function app_private.check_offer_references(uuid, uuid, uuid, uuid, text, uuid) to service_role;

-- 4. Creates an offer in „Entwurf“: the next number, the default recipient,
-- the validity and texts of the company profile (30 days and no text without
-- one), and the actor as the responsible member. p_work_kind is job, project
-- or request with p_work_id, or both null. A call under an attempt key that
-- already created an offer returns that offer and writes nothing.
-- Refusals: invalid_input, not_authorized and those of check_offer_references.
create function public.create_offer(
  p_actor_id uuid,
  p_organization_id uuid,
  p_attempt_key uuid,
  p_title text,
  p_client_id uuid,
  p_site_id uuid,
  p_contact_id uuid,
  p_work_kind text,
  p_work_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_offer_id uuid;
  v_recipient_id uuid;
  v_days integer := 30;
  v_opening text := '';
  v_closing text := '';
begin
  if p_actor_id is null or p_organization_id is null or p_attempt_key is null or p_client_id is null
    or btrim(coalesce(p_title, '')) = ''
    or (p_work_kind is null) <> (p_work_id is null)
    or p_work_kind not in ('job', 'project', 'request')
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  -- The organization's number lock, taken before the lookup: a call that
  -- overlaps an earlier call under the same key waits for it and then reads
  -- its committed event instead of writing a second offer.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':offer-number', 0));
  select event.offer_id into v_offer_id from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key
    and event.event_type = 'created' and event.actor_id = p_actor_id;
  if found then
    return v_offer_id;
  end if;

  perform app_private.check_offer_references(p_organization_id, p_client_id, p_site_id, p_contact_id,
    p_work_kind, p_work_id);
  v_recipient_id := (app_private.default_billing_recipient(p_organization_id, p_client_id, p_site_id)).recipient_client_id;
  select profile.offer_validity_days, profile.offer_opening_text, profile.offer_closing_text
  into v_days, v_opening, v_closing
  from public.company_document_profiles profile
  where profile.organization_id = p_organization_id;
  if not found then
    v_days := 30;
    v_opening := '';
    v_closing := '';
  end if;

  insert into public.offers (
    organization_id, offer_number, title, client_id, site_id, contact_id, recipient_client_id,
    valid_until, opening_text, closing_text, owner_user_id,
    request_id, job_id, project_id, created_by, updated_by
  ) values (
    p_organization_id, app_private.next_offer_number(p_organization_id), btrim(p_title),
    p_client_id, p_site_id, p_contact_id, v_recipient_id,
    (now() at time zone 'Europe/Berlin')::date + v_days, v_opening, v_closing, p_actor_id,
    case when p_work_kind = 'request' then p_work_id end,
    case when p_work_kind = 'job' then p_work_id end,
    case when p_work_kind = 'project' then p_work_id end,
    p_actor_id, p_actor_id
  )
  returning id into v_offer_id;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, actor_id, attempt_key
  ) values (p_organization_id, v_offer_id, 'created', 'entwurf', 1, p_actor_id, p_attempt_key);
  return v_offer_id;
end;
$$;
revoke all on function public.create_offer(uuid, uuid, uuid, text, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_offer(uuid, uuid, uuid, text, uuid, uuid, uuid, text, uuid)
  to service_role;

-- One page of the organization's offers, newest first, or of one customer's
-- (p_client_id). The search matches number, title and customer name; the
-- status filter one status, or every one when null. Total and order apply
-- before the page boundary.
create function public.list_offer_page(
  p_organization_id uuid,
  p_status text default null,
  p_search text default '',
  p_client_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select offer.id, offer.created_at
    from public.offers offer
    join public.clients client on client.id = offer.client_id and client.organization_id = p_organization_id
    where offer.organization_id = p_organization_id
      and (p_status is null or offer.status = p_status)
      and (p_client_id is null or offer.client_id = p_client_id)
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', offer.offer_number, offer.title, client.name)), lower(p_search)) > 0
      )
  ), page as (
    select * from matching order by created_at desc, id desc
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'hasAny', exists (
      select 1 from public.offers offer where offer.organization_id = p_organization_id
        and (p_client_id is null or offer.client_id = p_client_id)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', offer.id,
        'offerNumber', offer.offer_number,
        'title', offer.title,
        'status', offer.status,
        'clientId', offer.client_id,
        'clientName', client.name,
        'recipientName', case when offer.recipient_client_id <> offer.client_id then recipient.name end,
        'validUntil', offer.valid_until
      ) order by page.created_at desc, page.id desc)
      from page
      join public.offers offer on offer.id = page.id and offer.organization_id = p_organization_id
      join public.clients client on client.id = offer.client_id and client.organization_id = p_organization_id
      join public.clients recipient
        on recipient.id = offer.recipient_client_id and recipient.organization_id = p_organization_id
    ), '[]')
  );
$$;
revoke all on function public.list_offer_page(uuid, text, text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.list_offer_page(uuid, text, text, uuid, integer, integer) to service_role;

-- One offer of the organization with the names its header shows; null when
-- the organization has no such offer.
create function public.get_offer(p_organization_id uuid, p_offer_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', offer.id,
    'offerNumber', offer.offer_number,
    'title', offer.title,
    'status', offer.status,
    'version', offer.version,
    'validUntil', offer.valid_until,
    'openingText', offer.opening_text,
    'closingText', offer.closing_text,
    'client', jsonb_build_object('id', client.id, 'name', client.name),
    'site', (select jsonb_build_object('id', site.id, 'name', site.name, 'street', site.street,
        'postalCode', site.postal_code, 'city', site.city)
      from public.client_sites site
      where site.id = offer.site_id and site.organization_id = p_organization_id),
    'contact', (select jsonb_build_object('id', contact.id, 'name', contact.name)
      from public.client_contacts contact
      where contact.id = offer.contact_id and contact.organization_id = p_organization_id),
    'recipient', jsonb_build_object('id', recipient.id, 'name', recipient.name,
      'address', recipient.address, 'isDefault', offer.recipient_is_default),
    'owner', (select jsonb_build_object('userId', profile.id, 'firstName', profile.first_name,
        'lastName', profile.last_name, 'email', profile.email)
      from public.profiles profile where profile.id = offer.owner_user_id),
    'work', coalesce(
      (select jsonb_build_object('kind', 'job', 'id', job.id, 'number', job.job_number, 'title', job.title)
        from public.jobs job where job.id = offer.job_id and job.organization_id = p_organization_id),
      (select jsonb_build_object('kind', 'project', 'id', project.id, 'number', project.project_number,
          'title', project.name)
        from public.projects project
        where project.id = offer.project_id and project.organization_id = p_organization_id),
      (select jsonb_build_object('kind', 'request', 'id', request.id, 'number', request.request_number,
          'title', request.summary)
        from public.client_requests request
        where request.id = offer.request_id and request.organization_id = p_organization_id)
    )
  )
  from public.offers offer
  join public.clients client on client.id = offer.client_id and client.organization_id = p_organization_id
  join public.clients recipient
    on recipient.id = offer.recipient_client_id and recipient.organization_id = p_organization_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id;
$$;
revoke all on function public.get_offer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_offer(uuid, uuid) to service_role;

-- 5. A customer an offer names as Auftraggeber or Rechnungsempfänger is linked.
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
            where service_case.id = link.service_case_id))), 0),
    'offers', nullif((select count(*) from public.offers link
      where link.organization_id = p_organization_id
        and (link.client_id = p_client_id or link.recipient_client_id = p_client_id)), 0)
  ));
$$;
