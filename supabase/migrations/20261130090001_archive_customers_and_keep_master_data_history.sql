-- A customer with history is archived, not deleted, and every change to the
-- identity of a customer, contact or site keeps its history
-- (werk-flow/werkflow-planning#325).
--
-- 1. clients.archived_at marks an archived customer. It leaves the default
--    customer list and the work pickers, and its work stays.
-- 2. client_master_events is the append-only history of identity changes and
--    of archiving and restoring: one row per changed field with the old and
--    the new value, and its actor. A trigger on clients, client_contacts and
--    client_sites writes it inside the changing statement, so a change
--    without its history entry cannot exist. The write functions below name
--    the actor for the trigger; a write outside them, such as the previous
--    release's direct update or a data fix, records no actor.
-- 3. A delete guard refuses deleting a customer while a job, project,
--    request, Servicefall, Anlage, maintenance record, document or follow-up
--    links to it, for every role. Organization teardown passes.
--
-- Division of work: the server actions in lib/clients/actions.ts establish
-- identity, the manager role and the organization, and pass them. The
-- functions lock the row, check the actor's membership again and write.
--
-- Expand-only: the previous release keeps list_customer_page with four
-- arguments and its direct updates, which write history without an actor.
-- Its deletion of a linked customer refuses, as the rule asks.
--
-- Prevention: Tier 1 (the triggers), Tier 2 supabase/tests/client_archive_history.sql.

alter table public.clients add column archived_at timestamptz;

-- Append-only: service_role inserts and reads. The event-history guard
-- refuses an update or delete for every role; the deletion of an unlinked
-- customer or of the organization removes its events by cascade.
create table public.client_master_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  -- Set when the event concerns a contact or a site of the customer. No
  -- cascade: deleting a contact or site with history refuses at the end of
  -- the statement, while the customer's own deletion removes both in one
  -- statement through client_id.
  contact_id uuid references public.client_contacts (id),
  site_id uuid references public.client_sites (id),
  event_type text not null,
  -- A change: {"field": <column>, "old": <text or null>, "new": <text or null>}.
  event_payload jsonb not null default '{}'::jsonb,
  -- Null for a write outside the write functions below, and once the actor's
  -- account is deleted: the change stays, the person does not.
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint client_master_events_client_fk foreign key (client_id, organization_id)
    references public.clients (id, organization_id) on delete cascade,
  constraint client_master_events_subject_check check (contact_id is null or site_id is null),
  constraint client_master_events_type_check check (event_type in ('changed', 'archived', 'restored')),
  -- No payload cap: a change keeps an old value whatever its size, so an
  -- address saved before today's input limit can still be corrected.
  constraint client_master_events_change_check check (
    (event_type = 'changed') = (event_payload ? 'field')
  )
);

create index client_master_events_client_created_idx
  on public.client_master_events (organization_id, client_id, created_at desc, id desc);
create index client_master_events_contact_id_fk_idx on public.client_master_events (contact_id);
create index client_master_events_site_id_fk_idx on public.client_master_events (site_id);
create index client_master_events_actor_id_fk_idx on public.client_master_events (actor_id);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.client_master_events enable row level security;
revoke all on table public.client_master_events from public, anon, authenticated, service_role;
grant select, insert on table public.client_master_events to service_role;

create trigger guard_event_ledger_history before update or delete on public.client_master_events
  for each row execute function app_private.guard_event_ledger_history();

-- Writes one history row per changed identity field, and one for archiving
-- or restoring, in the statement that changes the row.
create function app_private.record_client_master_change()
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
  v_archive_column text;
  v_was_archived boolean;
  v_is_archived boolean;
  v_actor_id uuid := nullif(current_setting('app.client_actor_id', true), '')::uuid;
  v_client_id uuid;
  v_contact_id uuid;
  v_site_id uuid;
  v_changed text[] := array[]::text[];
begin
  if tg_table_name = 'clients' then
    v_fields := array['name', 'client_type', 'customer_number', 'address', 'email', 'phone'];
    v_client_id := new.id;
    v_was_archived := v_old ->> 'archived_at' is not null;
    v_is_archived := v_new ->> 'archived_at' is not null;
  elsif tg_table_name = 'client_contacts' then
    v_fields := array['name', 'email', 'phone'];
    v_client_id := (v_new ->> 'client_id')::uuid;
    v_contact_id := new.id;
    v_was_archived := not (v_old ->> 'is_active')::boolean;
    v_is_archived := not (v_new ->> 'is_active')::boolean;
  else
    v_fields := array['name', 'street', 'postal_code', 'city'];
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
revoke all on function app_private.record_client_master_change() from public, anon, authenticated;

create trigger record_client_master_change after update on public.clients
  for each row execute function app_private.record_client_master_change();
create trigger record_client_master_change after update on public.client_contacts
  for each row execute function app_private.record_client_master_change();
create trigger record_client_master_change after update on public.client_sites
  for each row execute function app_private.record_client_master_change();

-- The links that keep a customer: work, requests, service and maintenance
-- records, documents and follow-ups. Counted per kind for the refusal.
create function app_private.client_links(p_organization_id uuid, p_client_id uuid)
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
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0)
  ));
$$;
revoke all on function app_private.client_links(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.client_links(uuid, uuid) to service_role;

-- Refuses deleting a linked customer for every role. The organization's own
-- deletion passes (app.deleting_organization_ids, 20260823155732).
create function app_private.prevent_linked_client_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if pg_trigger_depth() > 1 and old.organization_id::text = any (
    string_to_array(current_setting('app.deleting_organization_ids', true), ',')
  ) then return old; end if;
  if app_private.client_links(old.organization_id, old.id) <> '{}'::jsonb then
    raise exception 'client_has_history';
  end if;
  return old;
end;
$$;
revoke all on function app_private.prevent_linked_client_delete() from public, anon, authenticated;

create trigger prevent_linked_client_delete before delete on public.clients
  for each row execute function app_private.prevent_linked_client_delete();

-- Locks the customer and the actor's manager membership and names the actor
-- for the history trigger. Refusals: invalid_input, client_not_found,
-- not_authorized.
create function app_private.lock_client_for_master_write(
  p_actor_id uuid,
  p_organization_id uuid,
  p_client_id uuid
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if p_actor_id is null or p_organization_id is null or p_client_id is null then
    raise exception 'invalid_input';
  end if;
  perform 1 from public.clients client
  where client.id = p_client_id and client.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'client_not_found';
  end if;
  -- A share lock holds the actor's membership until commit: a removal or a
  -- role change waits for this call or makes it refuse.
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
    and member.role in ('admin', 'buero')
  for share;
  if not found then
    raise exception 'not_authorized';
  end if;
  perform set_config('app.client_actor_id', p_actor_id::text, true);
end;
$$;
revoke all on function app_private.lock_client_for_master_write(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.lock_client_for_master_write(uuid, uuid, uuid) to service_role;

-- Saves the given master-data fields of a customer; a key missing from
-- p_changes keeps its value. Returns the saved customer.
create function public.update_client_master(
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
    email = case when p_changes ? 'email' then p_changes ->> 'email' else client.email end,
    phone = case when p_changes ? 'phone' then p_changes ->> 'phone' else client.phone end,
    address = case when p_changes ? 'address' then p_changes ->> 'address' else client.address end,
    notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else client.notes end
  where client.id = p_client_id and client.organization_id = p_organization_id
  returning * into v_client;
  return v_client;
end;
$$;
revoke all on function public.update_client_master(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_client_master(uuid, uuid, uuid, jsonb) to service_role;

-- Archives or restores a customer. Refuses client_already_archived or
-- client_not_archived when it is in that state already. Returns the customer.
create function public.set_client_archived(
  p_actor_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_archived boolean
)
returns public.clients
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_client public.clients;
begin
  if p_archived is null then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_client_for_master_write(p_actor_id, p_organization_id, p_client_id);
  update public.clients client
  set archived_at = case when p_archived then now() end
  where client.id = p_client_id and client.organization_id = p_organization_id
    and (client.archived_at is null) = p_archived
  returning * into v_client;
  if not found then
    raise exception '%', case when p_archived then 'client_already_archived' else 'client_not_archived' end;
  end if;
  return v_client;
end;
$$;
revoke all on function public.set_client_archived(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_client_archived(uuid, uuid, uuid, boolean) to service_role;

-- Deletes a customer nothing links to. A linked customer stays, and the
-- result names its links per kind: {"deleted": false, "links": {"jobs": 2}}.
create function public.delete_unlinked_client(
  p_actor_id uuid,
  p_organization_id uuid,
  p_client_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_links jsonb;
begin
  perform app_private.lock_client_for_master_write(p_actor_id, p_organization_id, p_client_id);
  v_links := app_private.client_links(p_organization_id, p_client_id);
  if v_links <> '{}'::jsonb then
    return jsonb_build_object('deleted', false, 'links', v_links);
  end if;
  delete from public.clients client
  where client.id = p_client_id and client.organization_id = p_organization_id;
  return jsonb_build_object('deleted', true, 'links', '{}'::jsonb);
end;
$$;
revoke all on function public.delete_unlinked_client(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_unlinked_client(uuid, uuid, uuid) to service_role;

-- Saves the given fields of a contact; a key missing from p_changes keeps its
-- value. Refusals as lock_client_for_master_write, and contact_not_found.
create function public.update_client_contact(
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
    is_primary = case when p_changes ? 'is_primary'
      then (p_changes ->> 'is_primary')::boolean else contact.is_primary end,
    is_active = case when p_changes ? 'is_active'
      then (p_changes ->> 'is_active')::boolean else contact.is_active end
  where contact.id = p_contact_id and contact.organization_id = p_organization_id
  returning * into v_contact;
  return v_contact;
end;
$$;
revoke all on function public.update_client_contact(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_client_contact(uuid, uuid, uuid, jsonb) to service_role;

-- Saves the given fields of a work site; a key missing from p_changes keeps
-- its value. Refusals as lock_client_for_master_write, and site_not_found.
create function public.update_client_site(
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
revoke all on function public.update_client_site(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_client_site(uuid, uuid, uuid, jsonb) to service_role;

-- The customer list, active or archived. The previous release's four-argument
-- call keeps its own overload, which lists every customer as before; a later
-- release drops it.
create function public.list_customer_page(
  p_organization_id uuid, p_search text, p_page integer, p_page_size integer, p_archived boolean
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select c.id, c.name from public.clients c
    where c.organization_id = p_organization_id and (c.archived_at is not null) = p_archived and (
      coalesce(p_search, '') = '' or
      strpos(lower(concat_ws(' ', c.name, c.customer_number, c.email, c.phone, c.address)), lower(p_search)) > 0 or
      exists (select 1 from public.client_contacts contact where contact.organization_id = p_organization_id and contact.client_id = c.id and contact.is_active and strpos(lower(contact.name), lower(p_search)) > 0) or
      exists (select 1 from public.client_sites site where site.organization_id = p_organization_id and site.client_id = c.id and site.is_active and strpos(lower(concat_ws(' ', site.name, site.street, site.postal_code, site.city)), lower(p_search)) > 0)
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
        'customerNumber', client.customer_number, 'email', client.email,
        'phone', client.phone, 'address', client.address, 'notes', client.notes,
        'createdAt', client.created_at, 'updatedAt', client.updated_at
      ) order by page.name collate "de-DE-x-icu", page.id)
      from page join public.clients client on client.id = page.id
      where client.organization_id = p_organization_id
    ), '[]')
  );
$$;
revoke all on function public.list_customer_page(uuid, text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.list_customer_page(uuid, text, integer, integer, boolean) to service_role;
