-- The office edits a sent offer as its next revision
-- (werk-flow/werkflow-planning#582, E2a K7b).
--
-- start_offer_revision turns a sent offer back into „Entwurf“ as the draft of
-- revision n+1, in one call: a new version and content version, and the
-- history entry naming revision n. The Titel and Positionen stay as they are:
-- they are what revision n froze, with the office's costs, which no revision
-- holds (20270601090000). Revision n stays as it was, with its filed PDF.
-- send_offer (20270601090000) then freezes the draft as revision n+1 under the
-- same offer row lock, numbering it after the newest sent one; from then on
-- revision n reads „Ersetzt durch Revision n+1“, derived from the newer
-- revision as „Abgelaufen“ is from the date, so no sent row ever changes.
-- A draft n+1 that is never sent stays a draft, and revision n stays the
-- newest sent one.
--
-- Division of work: the server action in lib/offers/actions.ts establishes
-- identity, the manager role and the organization and passes them; the
-- function checks the actor again under the access lock.
--
-- get_offer_with_revisions reads the offer with its costs and its sent revisions in one
-- statement, so the page never pairs a draft with a revision sent after it.
--
-- Expand-only: two new functions.
--
-- Prevention: Tier 1 (the status and version checks under the row lock, no
-- client grant), Tier 2 supabase/tests/offer_sending.sql.

-- Starts revision n+1 of the sent offer p_offer_id, which is still at
-- p_expected_version. The answer is {revision, version, updatedAt, replay}:
-- the draft's revision number, the offer's version after the call and its
-- transaction stamp, so the starting tab knows the Realtime echo of its start. A call under the
-- attempt key of an earlier start, or a start of the same sent version from
-- another tab, answers that start with replay true and writes nothing.
-- Refusals: invalid_input, not_authorized, offer_not_found, offer_not_sent
-- (a draft, revision n+1 included, or no longer „Gesendet“), offer_changed
-- (another change came first).
create function public.start_offer_revision(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_version integer,
  p_attempt_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_offer public.offers;
  v_earlier public.offer_events;
  v_sent integer;
  v_updated_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_version is null
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_offer from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;

  -- Under the row lock an earlier start of this offer has committed its event.
  select * into v_earlier from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key;
  -- A key answers only the start it was sent for: from the same offer at the same version.
  if found and (v_earlier.event_type <> 'revision_started' or v_earlier.offer_id <> p_offer_id
    or (v_earlier.payload ->> 'fromVersion')::integer <> p_expected_version) then
    raise exception 'invalid_input';
  end if;
  if not found then
    -- The same sent version started from another tab or under a lost key.
    select * into v_earlier from public.offer_events event
    where event.organization_id = p_organization_id and event.offer_id = p_offer_id
      and event.event_type = 'revision_started'
      and (event.payload ->> 'fromVersion')::integer = p_expected_version;
  end if;
  if found then
    return jsonb_build_object('revision', (v_earlier.payload ->> 'revision')::integer,
      'version', v_earlier.version, 'updatedAt', v_offer.updated_at, 'replay', true);
  end if;

  if v_offer.status <> 'gesendet' then raise exception 'offer_not_sent'; end if;
  if v_offer.version <> p_expected_version then raise exception 'offer_changed'; end if;
  select max(revision.revision) into v_sent from public.offer_revisions revision
  where revision.organization_id = p_organization_id and revision.offer_id = p_offer_id;
  if v_sent is null then raise exception 'offer_not_sent'; end if;

  update public.offers offer set
    status = 'entwurf',
    version = offer.version + 1,
    content_version = offer.content_version + 1,
    updated_by = p_actor_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  returning offer.updated_at into v_updated_at;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, 'revision_started', 'entwurf', v_offer.version + 1,
    jsonb_build_object('revision', v_sent + 1, 'replaces', v_sent,
      'fromVersion', v_offer.version, 'contentVersion', v_offer.content_version + 1),
    p_actor_id, p_attempt_key
  );
  return jsonb_build_object('revision', v_sent + 1, 'version', v_offer.version + 1,
    'updatedAt', v_updated_at, 'replay', false);
end;
$$;
revoke all on function public.start_offer_revision(uuid, uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.start_offer_revision(uuid, uuid, uuid, integer, uuid) to service_role;

-- The office page's read of one offer: {offer, costs} as get_offer_with_costs
-- answers it, or null, and its sent revisions as list_offer_revisions answers
-- them. Both are stable and run in this one statement, so they read one snapshot.
create function public.get_offer_with_revisions(p_organization_id uuid, p_offer_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'offer', public.get_offer_with_costs(p_organization_id, p_offer_id),
    'revisions', public.list_offer_revisions(p_organization_id, p_offer_id));
$$;
revoke all on function public.get_offer_with_revisions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_offer_with_revisions(uuid, uuid) to service_role;
