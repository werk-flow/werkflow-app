-- The office changes the header of an offer in „Entwurf“
-- (werk-flow/werkflow-planning#380, part 2).
--
-- update_offer saves title, Einsatzort and Ansprechpartner of the offer's
-- customer, the Rechnungsempfänger, validity, opening and closing text and the
-- responsible member in one call, against the version the form was filled
-- from, and writes the `changed` history row with each changed field in the
-- same call. The customer and the work an offer was written for stay as they
-- are: no form changes them here.
--
-- Division of work: the server action in lib/offers/actions.ts establishes
-- identity, the manager role and the organization, and passes them; the
-- function checks the actor again under the access lock
-- (app_private.lock_office_actor of 20261210130000).
--
-- Expand-only: one new function.
--
-- Prevention: Tier 2 supabase/tests/offers.sql.

-- p_recipient_client_id null follows the default rule
-- (app_private.default_billing_recipient), so a changed Einsatzort derives
-- the recipient again; a named customer stays until changed. A newly named
-- responsible person is an Admin or Büro member of the organization: the name
-- grants no access, so a suspended member may stay responsible. A kept
-- archived recipient and a kept responsible member who left the office stay
-- valid, so an unrelated change still saves. A call under the attempt key of an earlier
-- change of this offer returns that change's version and writes nothing; a
-- save that changes nothing returns the version and writes nothing.
-- Refusals: invalid_input, not_authorized, offer_not_found,
-- offer_not_editable (no longer „Entwurf“), offer_changed (another save
-- came first), site_not_found and contact_not_found (not the offer's
-- customer's), recipient_not_found, recipient_archived, owner_not_found.
create function public.update_offer(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_version integer,
  p_attempt_key uuid,
  p_title text,
  p_site_id uuid,
  p_contact_id uuid,
  p_recipient_client_id uuid,
  p_valid_until date,
  p_opening_text text,
  p_closing_text text,
  p_owner_user_id uuid
)
returns integer
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_old public.offers;
  v_new public.offers;
  v_replayed integer;
  v_archived boolean;
  v_changes jsonb;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_version is null or p_valid_until is null or p_owner_user_id is null
    or p_opening_text is null or p_closing_text is null
    or btrim(coalesce(p_title, '')) = '' or char_length(btrim(p_title)) > 200
    or char_length(p_opening_text) > 4000 or char_length(p_closing_text) > 4000
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_old from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;
  -- Under the row lock an earlier call under the same key has committed its event.
  select event.version into v_replayed from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key
    and event.offer_id = p_offer_id and event.actor_id = p_actor_id and event.event_type = 'changed';
  if found then
    return v_replayed;
  end if;
  if v_old.status <> 'entwurf' then raise exception 'offer_not_editable'; end if;
  if v_old.version <> p_expected_version then raise exception 'offer_changed'; end if;

  if p_site_id is not null and not exists (
    select 1 from public.client_sites site
    where site.id = p_site_id and site.organization_id = p_organization_id and site.client_id = v_old.client_id
  ) then
    raise exception 'site_not_found';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.client_contacts contact
    where contact.id = p_contact_id and contact.organization_id = p_organization_id
      and contact.client_id = v_old.client_id
  ) then
    raise exception 'contact_not_found';
  end if;
  if p_recipient_client_id is not null then
    select client.archived_at is not null into v_archived from public.clients client
    where client.id = p_recipient_client_id and client.organization_id = p_organization_id
    for share;
    if not found then raise exception 'recipient_not_found'; end if;
    if v_archived and p_recipient_client_id is distinct from v_old.recipient_client_id then
      raise exception 'recipient_archived';
    end if;
  end if;
  if p_owner_user_id is distinct from v_old.owner_user_id then
    perform 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_owner_user_id
      and member.role = any (array['admin'::public.org_role, 'buero'::public.org_role])
    for share;
    if not found then raise exception 'owner_not_found'; end if;
  end if;

  v_new := v_old;
  v_new.title := btrim(p_title);
  v_new.site_id := p_site_id;
  v_new.contact_id := p_contact_id;
  v_new.recipient_is_default := p_recipient_client_id is null;
  v_new.recipient_client_id := coalesce(p_recipient_client_id,
    (app_private.default_billing_recipient(p_organization_id, v_old.client_id, p_site_id)).recipient_client_id);
  v_new.valid_until := p_valid_until;
  v_new.opening_text := p_opening_text;
  v_new.closing_text := p_closing_text;
  v_new.owner_user_id := p_owner_user_id;

  select coalesce(jsonb_object_agg(field, jsonb_build_object('old', old_row -> field, 'new', new_row -> field)), '{}')
  into v_changes
  from (select to_jsonb(v_old) as old_row, to_jsonb(v_new) as new_row) rows,
    unnest(array['title', 'site_id', 'contact_id', 'recipient_client_id', 'recipient_is_default',
      'valid_until', 'opening_text', 'closing_text', 'owner_user_id']) field
  where (old_row -> field) is distinct from (new_row -> field);
  if v_changes = '{}' then
    return v_old.version;
  end if;

  update public.offers offer set
    title = v_new.title, site_id = v_new.site_id, contact_id = v_new.contact_id,
    recipient_client_id = v_new.recipient_client_id, recipient_is_default = v_new.recipient_is_default,
    valid_until = v_new.valid_until, opening_text = v_new.opening_text,
    closing_text = v_new.closing_text, owner_user_id = v_new.owner_user_id,
    version = offer.version + 1, updated_by = p_actor_id, updated_at = now()
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
    and offer.version = p_expected_version;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, 'changed', v_old.status, v_old.version + 1, v_changes,
    p_actor_id, p_attempt_key
  );
  return v_old.version + 1;
end;
$$;
revoke all on function public.update_offer(uuid, uuid, uuid, integer, uuid, text, uuid, uuid, uuid, date, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.update_offer(uuid, uuid, uuid, integer, uuid, text, uuid, uuid, uuid, date, text, text, uuid)
  to service_role;
