-- An Objekt knows its owner, manager, payer and access contacts over time
-- (werk-flow/werkflow-planning#326).
--
-- The model: a customer (clients) is any party that commissions or pays, one
-- record reused across buildings. An Objekt (client_sites, the Einsatzort)
-- stays filed under the customer it was created for and carries dated roles
-- Eigentümer, Hausverwaltung and Rechnungsempfänger, each pointing at a
-- customer of the organization. A change ends a role instead of overwriting
-- it. Mieter and Zugangskontakt are contacts of the Objekt's customer linked
-- to the Objekt, never customers. The Anlage stays at the Objekt.
--
-- 1. client_site_roles: one row per role holding. A role of one kind on one
--    Objekt never overlaps another (exclusion constraint). Only its end and
--    who ended it change, once; nothing deletes a role but the deletion of
--    its Objekt's unlinked customer or of the organization.
-- 2. client_contacts.site_id and site_role link a contact to an Objekt of its
--    own customer as Mieter or Zugangskontakt. Moving out archives it.
-- 3. clients.source_number and client_sites.source_number: the numbers the
--    previous system gave the customer and the Objekt, unique per
--    organization and found by the customer search.
-- 4. History through 20261130090001's mechanism: starting and ending a role
--    write client_master_events for the Objekt's customer and for the holder;
--    source numbers and a contact's Objekt link join the tracked fields.
-- 5. The delete guard counts a role between two customers as a link.
-- 6. The customer search finds an Objekt by name, street, postal code, city
--    or source number, lists the matching Objekte under their customer and
--    under each customer holding a current or coming role on them, with
--    their current roles and Anlagen.
--
-- Division of work: the server actions in lib/clients/ establish identity,
-- the manager role and the organization, and pass them. The functions lock
-- the Objekt's customer, check the actor's membership again and write.
--
-- Expand-only: the previous release reads and writes none of the new columns
-- and functions; its chronology shows a role event as „Einsatzort geändert“,
-- its deletion dialog a role link without its kind.
--
-- Prevention: Tier 1 (constraints and triggers), Tier 2
-- supabase/tests/client_site_roles.sql.

-- 3. Source numbers.
alter table public.clients add column source_number text;
alter table public.client_sites add column source_number text;
-- @destructive: after release 2b43be8f: that build never writes source_number, so the check holds for its writes
alter table public.clients add constraint clients_source_number_check
  check (source_number is null or (source_number = btrim(source_number) and length(source_number) between 1 and 100));
-- @destructive: after release 2b43be8f: that build never writes source_number, so the check holds for its writes
alter table public.client_sites add constraint client_sites_source_number_check
  check (source_number is null or (source_number = btrim(source_number) and length(source_number) between 1 and 100));
-- @destructive: after release 2b43be8f: that build never writes source_number, so every row it writes stays null there
create unique index clients_source_number_per_org
  on public.clients (organization_id, lower(source_number)) where source_number is not null;
-- @destructive: after release 2b43be8f: that build never writes source_number, so every row it writes stays null there
create unique index client_sites_source_number_per_org
  on public.client_sites (organization_id, lower(source_number)) where source_number is not null;

-- 2. Contacts at an Objekt. The Objekt belongs to the contact's own
-- customer; a later move of the Objekt to another customer takes them along.
-- @destructive: after release 2b43be8f: that build never writes site_id or site_role, so the key and the check hold for its writes
alter table public.client_contacts
  add column site_id uuid,
  add column site_role text,
  add constraint client_contacts_site_fk foreign key (site_id, client_id, organization_id)
    references public.client_sites (id, client_id, organization_id) on update cascade,
  add constraint client_contacts_site_role_check check (
    (site_id is null) = (site_role is null) and (site_role is null or site_role in ('mieter', 'zugangskontakt'))
  );
create index client_contacts_site_id_idx on public.client_contacts (site_id) where site_id is not null;

-- 1. Dated roles.
create table public.client_site_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null,
  -- The customer the Objekt is filed under (client_sites.client_id).
  client_id uuid not null,
  -- The customer holding the role.
  holder_client_id uuid not null,
  role text not null,
  -- First day of the role in Berlin; null when it is not known since when.
  starts_on date,
  -- Last day of the role, inclusive; null while it lasts.
  ends_on date,
  created_by uuid references auth.users (id) on delete set null,
  ended_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_site_roles_site_fk foreign key (site_id, client_id, organization_id)
    references public.client_sites (id, client_id, organization_id) on update cascade on delete cascade,
  -- The delete guard refuses deleting a holder of a role on another
  -- customer's Objekt, so the cascade removes only a customer's roles on its
  -- own Objekte, together with them.
  constraint client_site_roles_holder_fk foreign key (holder_client_id, organization_id)
    references public.clients (id, organization_id) on delete cascade,
  constraint client_site_roles_role_check check (role in ('eigentuemer', 'hausverwaltung', 'rechnungsempfaenger')),
  constraint client_site_roles_range_check check (starts_on is null or ends_on is null or ends_on >= starts_on),
  constraint client_site_roles_no_overlap exclude using gist (
    site_id with =,
    role with =,
    daterange(starts_on, ends_on, '[]') with &&
  )
);

create unique index client_site_roles_replident_idx on public.client_site_roles (id, organization_id);
create index client_site_roles_client_idx on public.client_site_roles (organization_id, client_id);
create index client_site_roles_holder_idx on public.client_site_roles (organization_id, holder_client_id);
create index client_site_roles_holder_fk_idx on public.client_site_roles (holder_client_id);
create index client_site_roles_site_fk_idx on public.client_site_roles (site_id, client_id, organization_id);
create index client_site_roles_created_by_fk_idx on public.client_site_roles (created_by);
create index client_site_roles_ended_by_fk_idx on public.client_site_roles (ended_by);

alter table public.client_site_roles enable row level security;
-- A manager's session reads the rows only to hear of a change; the server
-- reads and writes them.
create policy "Managers can view client site roles in their orgs" on public.client_site_roles
  for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
revoke all on table public.client_site_roles from public, anon, authenticated, service_role;
grant select on table public.client_site_roles to authenticated;
grant select, insert, update on table public.client_site_roles to service_role;

create trigger client_site_roles_updated_at before update on public.client_site_roles
  for each row execute function update_updated_at_column();

alter table public.client_site_roles replica identity using index client_site_roles_replident_idx;
alter publication supabase_realtime add table public.client_site_roles;
create trigger emit_realtime_deletion after delete on public.client_site_roles
  for each row execute function app_private.emit_realtime_deletion();

-- A role is history: only its end and who ended it are set, once. A deleted
-- account clears its actor. The move of its Objekt to another customer
-- changes client_id through the cascade and passes.
create function app_private.guard_client_site_role_history()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.site_id is distinct from old.site_id
    or new.holder_client_id is distinct from old.holder_client_id
    or new.role is distinct from old.role
    or new.starts_on is distinct from old.starts_on
    or new.created_at is distinct from old.created_at
    or (new.created_by is distinct from old.created_by and new.created_by is not null)
    or (old.ends_on is not null and new.ends_on is distinct from old.ends_on)
    or (new.ended_by is distinct from old.ended_by and new.ended_by is not null
      and (old.ends_on is not null or new.ends_on is null))
  then
    raise exception 'client_site_role_history_immutable';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_client_site_role_history() from public, anon, authenticated;

create trigger guard_client_site_role_history before update on public.client_site_roles
  for each row when (new.client_id is not distinct from old.client_id)
  execute function app_private.guard_client_site_role_history();

-- 4. History. The event types for a role join the existing ones.
-- @destructive: after release 2b43be8f: the replacement below widens the event types; that build writes only the types it keeps
alter table public.client_master_events drop constraint client_master_events_type_check;
-- @destructive: after release 2b43be8f: widens the event types by role_started and role_ended; that build writes only the types it keeps
alter table public.client_master_events add constraint client_master_events_type_check
  check (event_type in ('changed', 'archived', 'restored', 'role_started', 'role_ended'));

-- Writes 'role_started' when a role is recorded and 'role_ended' when its end
-- is set, once for the Objekt's customer and once for a different holder.
-- The payload keeps the holder's and the Objekt's names as they were.
create function app_private.record_client_site_role_change()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_event_type text;
  v_payload jsonb;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'role_started';
  elsif old.ends_on is null and new.ends_on is not null then
    v_event_type := 'role_ended';
  else
    return null;
  end if;
  select jsonb_build_object(
    'role', new.role,
    'holder_client_id', new.holder_client_id,
    'holder_name', holder.name,
    'site_client_id', new.client_id,
    'site_name', site.name,
    'starts_on', new.starts_on,
    'ends_on', new.ends_on
  ) into v_payload
  from public.clients holder, public.client_sites site
  where holder.id = new.holder_client_id and site.id = new.site_id;

  insert into public.client_master_events (
    organization_id, client_id, site_id, event_type, event_payload, actor_id
  )
  select new.organization_id, subject.client_id, new.site_id, v_event_type, v_payload,
    nullif(current_setting('app.client_actor_id', true), '')::uuid
  from (select new.client_id union select new.holder_client_id) subject (client_id);
  return null;
end;
$$;
revoke all on function app_private.record_client_site_role_change() from public, anon, authenticated;

create trigger record_client_site_role_change after insert or update on public.client_site_roles
  for each row execute function app_private.record_client_site_role_change();

-- The tracked fields gain the source numbers and a contact's Objekt link.
create or replace function app_private.record_client_master_change()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_fields text[];
  v_field text;
  v_was_archived boolean;
  v_is_archived boolean;
  v_actor_id uuid := nullif(current_setting('app.client_actor_id', true), '')::uuid;
  v_client_id uuid;
  v_contact_id uuid;
  v_site_id uuid;
  v_changed text[] := array[]::text[];
begin
  if tg_table_name = 'clients' then
    v_fields := array['name', 'client_type', 'customer_number', 'source_number', 'address', 'email', 'phone'];
    v_client_id := new.id;
    v_was_archived := v_old ->> 'archived_at' is not null;
    v_is_archived := v_new ->> 'archived_at' is not null;
  elsif tg_table_name = 'client_contacts' then
    v_fields := array['name', 'email', 'phone', 'site_id', 'site_role'];
    v_client_id := (v_new ->> 'client_id')::uuid;
    v_contact_id := new.id;
    v_was_archived := not (v_old ->> 'is_active')::boolean;
    v_is_archived := not (v_new ->> 'is_active')::boolean;
  else
    v_fields := array['name', 'street', 'postal_code', 'city', 'source_number'];
    v_client_id := (v_new ->> 'client_id')::uuid;
    v_site_id := new.id;
    v_was_archived := not (v_old ->> 'is_active')::boolean;
    v_is_archived := not (v_new ->> 'is_active')::boolean;
  end if;

  foreach v_field in array v_fields loop
    if v_old -> v_field is distinct from v_new -> v_field then
      v_changed := v_changed || v_field;
    end if;
  end loop;
  if cardinality(v_changed) = 0 and v_was_archived = v_is_archived then
    return null;
  end if;
  insert into public.client_master_events (
    organization_id, client_id, contact_id, site_id, event_type, event_payload, actor_id
  )
  select new.organization_id, v_client_id, v_contact_id, v_site_id, 'changed',
    jsonb_build_object('field', field, 'old', v_old ->> field, 'new', v_new ->> field), v_actor_id
  from unnest(v_changed) field;

  if v_was_archived <> v_is_archived then
    insert into public.client_master_events (
      organization_id, client_id, contact_id, site_id, event_type, actor_id
    ) values (
      new.organization_id, v_client_id, v_contact_id, v_site_id,
      case when v_is_archived then 'archived' else 'restored' end, v_actor_id
    );
  end if;
  return null;
end;
$$;

-- 5. A role between two customers links both: the holder and the customer
-- the Objekt is filed under. A customer's role on its own Objekt is no link.
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
        and (link.client_id = p_client_id or link.holder_client_id = p_client_id)), 0)
  ));
$$;

-- The write functions of 20261130090001 take the new fields.
create or replace function public.update_client_master(
  p_actor_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_changes jsonb
)
returns public.clients
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_client public.clients;
begin
  perform app_private.lock_client_for_master_write(p_actor_id, p_organization_id, p_client_id);
  update public.clients client set
    name = case when p_changes ? 'name' then p_changes ->> 'name' else client.name end,
    client_type = case when p_changes ? 'client_type'
      then (p_changes ->> 'client_type')::public.client_type else client.client_type end,
    customer_number = case when p_changes ? 'customer_number'
      then p_changes ->> 'customer_number' else client.customer_number end,
    source_number = case when p_changes ? 'source_number'
      then p_changes ->> 'source_number' else client.source_number end,
    email = case when p_changes ? 'email' then p_changes ->> 'email' else client.email end,
    phone = case when p_changes ? 'phone' then p_changes ->> 'phone' else client.phone end,
    address = case when p_changes ? 'address' then p_changes ->> 'address' else client.address end,
    notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else client.notes end
  where client.id = p_client_id and client.organization_id = p_organization_id
  returning * into v_client;
  return v_client;
end;
$$;

create or replace function public.update_client_contact(
  p_actor_id uuid,
  p_organization_id uuid,
  p_contact_id uuid,
  p_changes jsonb
)
returns public.client_contacts
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_client_id uuid;
  v_contact public.client_contacts;
begin
  select contact.client_id into v_client_id from public.client_contacts contact
  where contact.id = p_contact_id and contact.organization_id = p_organization_id;
  if not found then
    raise exception 'contact_not_found';
  end if;
  perform app_private.lock_client_for_master_write(p_actor_id, p_organization_id, v_client_id);
  update public.client_contacts contact set
    name = case when p_changes ? 'name' then p_changes ->> 'name' else contact.name end,
    role = case when p_changes ? 'role' then p_changes ->> 'role' else contact.role end,
    email = case when p_changes ? 'email' then p_changes ->> 'email' else contact.email end,
    phone = case when p_changes ? 'phone' then p_changes ->> 'phone' else contact.phone end,
    notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else contact.notes end,
    site_id = case when p_changes ? 'site_id' then (p_changes ->> 'site_id')::uuid else contact.site_id end,
    site_role = case when p_changes ? 'site_role' then p_changes ->> 'site_role' else contact.site_role end,
    is_primary = case when p_changes ? 'is_primary'
      then (p_changes ->> 'is_primary')::boolean else contact.is_primary end,
    is_active = case when p_changes ? 'is_active'
      then (p_changes ->> 'is_active')::boolean else contact.is_active end
  where contact.id = p_contact_id and contact.organization_id = p_organization_id
  returning * into v_contact;
  return v_contact;
end;
$$;

create or replace function public.update_client_site(
  p_actor_id uuid,
  p_organization_id uuid,
  p_site_id uuid,
  p_changes jsonb
)
returns public.client_sites
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_client_id uuid;
  v_site public.client_sites;
begin
  select site.client_id into v_client_id from public.client_sites site
  where site.id = p_site_id and site.organization_id = p_organization_id;
  if not found then
    raise exception 'site_not_found';
  end if;
  perform app_private.lock_client_for_master_write(p_actor_id, p_organization_id, v_client_id);
  update public.client_sites site set
    name = case when p_changes ? 'name' then p_changes ->> 'name' else site.name end,
    street = case when p_changes ? 'street' then p_changes ->> 'street' else site.street end,
    postal_code = case when p_changes ? 'postal_code' then p_changes ->> 'postal_code' else site.postal_code end,
    city = case when p_changes ? 'city' then p_changes ->> 'city' else site.city end,
    source_number = case when p_changes ? 'source_number'
      then p_changes ->> 'source_number' else site.source_number end,
    access_notes = case when p_changes ? 'access_notes'
      then p_changes ->> 'access_notes' else site.access_notes end,
    notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else site.notes end,
    primary_contact_id = case when p_changes ? 'primary_contact_id'
      then (p_changes ->> 'primary_contact_id')::uuid else site.primary_contact_id end,
    is_primary = case when p_changes ? 'is_primary'
      then (p_changes ->> 'is_primary')::boolean else site.is_primary end,
    is_active = case when p_changes ? 'is_active'
      then (p_changes ->> 'is_active')::boolean else site.is_active end
  where site.id = p_site_id and site.organization_id = p_organization_id
  returning * into v_site;
  return v_site;
end;
$$;

-- Records a role on an Objekt. With p_replace, the open role of that kind
-- ends the day before p_starts_on in the same call: a change of Hausverwaltung
-- or owner. Refusals as lock_client_for_master_write, and invalid_input,
-- site_not_found, holder_not_found, holder_archived, holder_unchanged,
-- role_starts_before_current and role_overlaps.
create function public.assign_client_site_role(
  p_actor_id uuid,
  p_organization_id uuid,
  p_site_id uuid,
  p_role text,
  p_holder_client_id uuid,
  p_replace boolean,
  p_starts_on date default null
)
returns public.client_site_roles
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_client_id uuid;
  v_holder_archived_at timestamptz;
  v_open public.client_site_roles;
  v_role public.client_site_roles;
begin
  if p_role is null or p_role not in ('eigentuemer', 'hausverwaltung', 'rechnungsempfaenger')
    or p_holder_client_id is null or p_replace is null or (p_replace and p_starts_on is null)
  then
    raise exception 'invalid_input';
  end if;
  select site.client_id into v_client_id from public.client_sites site
  where site.id = p_site_id and site.organization_id = p_organization_id;
  if not found then
    raise exception 'site_not_found';
  end if;
  perform app_private.lock_client_for_master_write(p_actor_id, p_organization_id, v_client_id);
  select holder.archived_at into v_holder_archived_at from public.clients holder
  where holder.id = p_holder_client_id and holder.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'holder_not_found';
  end if;
  if v_holder_archived_at is not null then
    raise exception 'holder_archived';
  end if;

  if p_replace then
    select * into v_open from public.client_site_roles role
    where role.organization_id = p_organization_id and role.site_id = p_site_id
      and role.role = p_role and role.ends_on is null
    for update;
    if found then
      if v_open.holder_client_id = p_holder_client_id then
        raise exception 'holder_unchanged';
      end if;
      if v_open.starts_on is not null and v_open.starts_on > p_starts_on - 1 then
        raise exception 'role_starts_before_current';
      end if;
      update public.client_site_roles role
      set ends_on = p_starts_on - 1, ended_by = p_actor_id
      where role.id = v_open.id;
    end if;
  end if;

  begin
    insert into public.client_site_roles (
      organization_id, site_id, client_id, holder_client_id, role, starts_on, created_by
    ) values (
      p_organization_id, p_site_id, v_client_id, p_holder_client_id, p_role, p_starts_on, p_actor_id
    )
    returning * into v_role;
  exception when exclusion_violation then
    raise exception 'role_overlaps';
  end;
  return v_role;
end;
$$;
revoke all on function public.assign_client_site_role(uuid, uuid, uuid, text, uuid, boolean, date)
  from public, anon, authenticated;
grant execute on function public.assign_client_site_role(uuid, uuid, uuid, text, uuid, boolean, date)
  to service_role;

-- Ends a role on its last day, inclusive. The role stays as history.
-- Refusals as lock_client_for_master_write, and invalid_input,
-- role_not_found, role_already_ended and role_ends_before_start.
create function public.end_client_site_role(
  p_actor_id uuid,
  p_organization_id uuid,
  p_role_id uuid,
  p_ends_on date
)
returns public.client_site_roles
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_role public.client_site_roles;
begin
  if p_ends_on is null then
    raise exception 'invalid_input';
  end if;
  select * into v_role from public.client_site_roles role
  where role.id = p_role_id and role.organization_id = p_organization_id;
  if not found then
    raise exception 'role_not_found';
  end if;
  perform app_private.lock_client_for_master_write(p_actor_id, p_organization_id, v_role.client_id);
  if v_role.starts_on is not null and p_ends_on < v_role.starts_on then
    raise exception 'role_ends_before_start';
  end if;
  update public.client_site_roles role
  set ends_on = p_ends_on, ended_by = p_actor_id
  where role.id = p_role_id and role.organization_id = p_organization_id and role.ends_on is null
  returning * into v_role;
  if not found then
    raise exception 'role_already_ended';
  end if;
  return v_role;
end;
$$;
revoke all on function public.end_client_site_role(uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.end_client_site_role(uuid, uuid, uuid, date) to service_role;

-- Every role on the customer's own Objekte and every role it holds on
-- another customer's Objekt, ended ones included, with the names the page
-- shows. Ordered so a reader can page through it.
create function public.list_client_site_roles(p_organization_id uuid, p_client_id uuid)
returns table (
  id uuid,
  site_id uuid,
  site_name text,
  site_street text,
  site_postal_code text,
  site_city text,
  site_source_number text,
  site_is_active boolean,
  site_client_id uuid,
  site_client_name text,
  holder_client_id uuid,
  holder_name text,
  holder_archived_at timestamptz,
  role text,
  starts_on date,
  ends_on date
)
language sql
stable
security invoker
set search_path to ''
as $$
  select role.id, site.id, site.name, site.street, site.postal_code, site.city, site.source_number,
    site.is_active, owner.id, owner.name, holder.id, holder.name, holder.archived_at,
    role.role, role.starts_on, role.ends_on
  from public.client_site_roles role
  join public.client_sites site on site.id = role.site_id and site.organization_id = p_organization_id
  join public.clients owner on owner.id = role.client_id and owner.organization_id = p_organization_id
  join public.clients holder on holder.id = role.holder_client_id and holder.organization_id = p_organization_id
  where role.organization_id = p_organization_id
    and (role.client_id = p_client_id or role.holder_client_id = p_client_id)
  order by site.name collate "de-DE-x-icu", site.id, role.role, role.starts_on nulls first, role.id;
$$;
revoke all on function public.list_client_site_roles(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_client_site_roles(uuid, uuid) to service_role;

-- 6. The customer list. A search also matches the source numbers, and an
-- Objekt matches by name, street, postal code, city or source number. Each
-- customer of the page lists the matching Objekte it is filed under or holds
-- a current or coming role on: the first three with their current roles and
-- first five active Anlagen, and the totals.
create or replace function public.list_customer_page(
  p_organization_id uuid, p_search text, p_page integer, p_page_size integer, p_archived boolean
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matched_sites as materialized (
    select site.id, site.client_id from public.client_sites site
    where coalesce(p_search, '') <> '' and site.organization_id = p_organization_id and site.is_active
      and strpos(lower(concat_ws(' ', site.name, site.street, site.postal_code, site.city, site.source_number)), lower(p_search)) > 0
  ), site_parties as materialized (
    select matched.id as site_id, matched.client_id from matched_sites matched
    union
    select role.site_id, role.holder_client_id from public.client_site_roles role
    join matched_sites matched on matched.id = role.site_id
    where role.organization_id = p_organization_id
      and (role.ends_on is null or role.ends_on >= (now() at time zone 'Europe/Berlin')::date)
  ), matching as materialized (
    select c.id, c.name from public.clients c
    where c.organization_id = p_organization_id and (c.archived_at is not null) = p_archived and (
      coalesce(p_search, '') = '' or
      strpos(lower(concat_ws(' ', c.name, c.customer_number, c.source_number, c.email, c.phone, c.address)), lower(p_search)) > 0 or
      exists (select 1 from public.client_contacts contact where contact.organization_id = p_organization_id and contact.client_id = c.id and contact.is_active and strpos(lower(contact.name), lower(p_search)) > 0) or
      exists (select 1 from site_parties party where party.client_id = c.id)
    )
  ), page as (
    select id, name from matching order by name collate "de-DE-x-icu", id
    limit least(greatest(p_page_size, 1), 100) offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', client.id, 'organizationId', client.organization_id,
        'name', client.name, 'clientType', client.client_type,
        'customerNumber', client.customer_number, 'sourceNumber', client.source_number,
        'email', client.email, 'phone', client.phone, 'address', client.address, 'notes', client.notes,
        'createdAt', client.created_at, 'updatedAt', client.updated_at,
        'matchedSiteTotal', (select count(*) from site_parties party where party.client_id = page.id),
        'matchedSites', coalesce((
          select jsonb_agg(shown.site order by shown.name collate "de-DE-x-icu", shown.id)
          from (
            select site.id, site.name, jsonb_build_object(
              'id', site.id, 'name', site.name, 'street', site.street,
              'postalCode', site.postal_code, 'city', site.city, 'sourceNumber', site.source_number,
              'clientId', owner.id, 'clientName', owner.name,
              'roles', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'role', role.role, 'holderClientId', holder.id, 'holderName', holder.name
                ) order by role.role)
                from public.client_site_roles role
                join public.clients holder on holder.id = role.holder_client_id and holder.organization_id = p_organization_id
                where role.organization_id = p_organization_id and role.site_id = site.id
                  and (role.starts_on is null or role.starts_on <= (now() at time zone 'Europe/Berlin')::date)
                  and (role.ends_on is null or role.ends_on >= (now() at time zone 'Europe/Berlin')::date)
              ), '[]'),
              'equipment', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', item.id, 'name', item.name, 'equipmentNumber', item.equipment_number
                ) order by item.name collate "de-DE-x-icu", item.id)
                from (
                  select equipment.id, equipment.name, equipment.equipment_number
                  from public.installed_equipment equipment
                  where equipment.organization_id = p_organization_id and equipment.site_id = site.id
                    and equipment.archived_at is null and equipment.voided_at is null
                  order by equipment.name collate "de-DE-x-icu", equipment.id
                  limit 5
                ) item
              ), '[]'),
              'equipmentTotal', (
                select count(*) from public.installed_equipment equipment
                where equipment.organization_id = p_organization_id and equipment.site_id = site.id
                  and equipment.archived_at is null and equipment.voided_at is null
              )
            ) as site
            from site_parties party
            join public.client_sites site on site.id = party.site_id and site.organization_id = p_organization_id
            join public.clients owner on owner.id = site.client_id and owner.organization_id = p_organization_id
            where party.client_id = page.id
            order by site.name collate "de-DE-x-icu", site.id
            limit 3
          ) shown
        ), '[]')
      ) order by page.name collate "de-DE-x-icu", page.id)
      from page join public.clients client on client.id = page.id
      where client.organization_id = p_organization_id
    ), '[]')
  );
$$;
