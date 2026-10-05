-- One customer has at most one primary contact and one primary work site.
-- The server actions createClientContact, updateClientContact,
-- createClientSite and updateClientSite in lib/clients/actions.ts wrote the
-- row first and cleared the previous primary marker in a second statement.
-- A failed second statement left two primaries behind while the action
-- reported a failure for a row that was already saved.
--
-- The marker is now kept by the database: a before trigger clears the other
-- primary rows of the same customer inside the statement that sets the new
-- one, so the action writes once. The trigger locks the customer row first,
-- so two concurrent primary changes of one customer serialize and the later
-- one wins. A partial unique index refuses a second primary from any path.
--
-- Signals stay as before: the cleared rows are UPDATEs of published tables
-- and reach the Realtime publication.

-- Existing duplicates keep the most recently changed primary.
update public.client_contacts contact
set is_primary = false
where contact.is_primary
  and exists (
    select 1 from public.client_contacts newer
    where newer.client_id = contact.client_id
      and newer.is_primary
      and (newer.updated_at, newer.id) > (contact.updated_at, contact.id)
  );

update public.client_sites site
set is_primary = false
where site.is_primary
  and exists (
    select 1 from public.client_sites newer
    where newer.client_id = site.client_id
      and newer.is_primary
      and (newer.updated_at, newer.id) > (site.updated_at, site.id)
  );

create unique index client_contacts_one_primary_per_client
  on public.client_contacts (client_id)
  where is_primary;

create unique index client_sites_one_primary_per_client
  on public.client_sites (client_id)
  where is_primary;

create function app_private.keep_one_primary_client_contact()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not new.is_primary
    or (tg_op = 'UPDATE' and old.is_primary and old.client_id = new.client_id)
  then
    return new;
  end if;

  perform 1 from public.clients client
  where client.id = new.client_id and client.organization_id = new.organization_id
  for no key update;

  update public.client_contacts contact
  set is_primary = false
  where contact.client_id = new.client_id
    and contact.organization_id = new.organization_id
    and contact.is_primary
    and contact.id <> new.id;
  return new;
end;
$$;

create function app_private.keep_one_primary_client_site()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not new.is_primary
    or (tg_op = 'UPDATE' and old.is_primary and old.client_id = new.client_id)
  then
    return new;
  end if;

  perform 1 from public.clients client
  where client.id = new.client_id and client.organization_id = new.organization_id
  for no key update;

  update public.client_sites site
  set is_primary = false
  where site.client_id = new.client_id
    and site.organization_id = new.organization_id
    and site.is_primary
    and site.id <> new.id;
  return new;
end;
$$;

revoke all on function app_private.keep_one_primary_client_contact()
  from public, anon, authenticated, service_role;
revoke all on function app_private.keep_one_primary_client_site()
  from public, anon, authenticated, service_role;

create trigger client_contacts_keep_one_primary
  before insert or update of is_primary, client_id on public.client_contacts
  for each row execute function app_private.keep_one_primary_client_contact();

create trigger client_sites_keep_one_primary
  before insert or update of is_primary, client_id on public.client_sites
  for each row execute function app_private.keep_one_primary_client_site();
