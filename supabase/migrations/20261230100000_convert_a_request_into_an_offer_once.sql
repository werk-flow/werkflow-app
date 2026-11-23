-- A request becomes an offer once (werk-flow/werkflow-planning#386).
--
-- An open request with a customer converts into a new offer draft, as it
-- converts into a job or project: create_offer writes the offer with its
-- number, default recipient, validity and texts, for the request's customer
-- with the chosen Objekt and Ansprechpartner. A recipient the office chose on
-- the request carries over. The request is marked converted and names the
-- offer; its documents are linked to the offer as a second link to the same
-- file; the 'converted' history row records the attempt key. One call, or
-- nothing changes. A retry under that key returns the first offer; any other
-- second conversion is refused (app_private.lock_request_for_conversion).
--
-- 1. client_requests.converted_offer_id: the offer a conversion made.
-- 2. document_links.offer_id: the link target `offer`. An offer's document is
--    an office document: no field read follows an offer link.
-- 3. lock_request_for_conversion learns the target 'offer'.
-- 4. convert_client_request_to_offer: the office's write.
--
-- Division of work: the server action in lib/requests/ establishes identity,
-- the manager role and the organization, and passes them; the function checks
-- the actor's membership, role and access again (app_private.lock_office_actor).
--
-- Expand-only: new columns, a new function, and a replaced function that keeps
-- its signature and its answers for 'job' and 'project'.
--
-- Prevention: Tier 1 (constraints), Tier 2 supabase/tests/request_retry_results.sql
-- and request_offer_conversion_concurrency.sql.

-- 1. The offer a request was converted into; a request names one work at most.
alter table public.client_requests add column converted_offer_id uuid;
-- @destructive: after release 55088f06: that build never writes converted_offer_id, and the key accepts its null
alter table public.client_requests
  add constraint client_requests_converted_offer_fk foreign key (converted_offer_id, organization_id)
  references public.offers (id, organization_id) on delete set null (converted_offer_id);
-- @destructive: after release 55088f06: that build never writes converted_offer_id, so the check holds for its writes
alter table public.client_requests
  add constraint client_requests_one_conversion_check check (
    converted_offer_id is null or (converted_job_id is null and converted_project_id is null)
  ) not valid;
-- @destructive: after release 55088f06: that build never writes converted_offer_id, and null values never collide
create unique index client_requests_converted_offer_idx
  on public.client_requests (converted_offer_id) where converted_offer_id is not null;

-- 2. The link target `offer`.
alter table public.document_links add column offer_id uuid;
-- @destructive: after release 55088f06: that build never writes offer_id, and the key accepts its null
alter table public.document_links
  add constraint document_links_offer_fk foreign key (offer_id, organization_id)
  references public.offers (id, organization_id) on delete cascade;
-- @destructive: after release 55088f06: the replacement below adds offer_id to the same rule, which that build never writes
alter table public.document_links drop constraint document_links_exactly_one_target_check;
-- @destructive: after release 55088f06: that build never writes offer_id, so each of its links still names one target
alter table public.document_links
  add constraint document_links_exactly_one_target_check check (
    num_nonnulls(
      job_id, project_id, client_id, employee_id, request_id,
      equipment_id, service_case_id, maintenance_coverage_id, offer_id
    ) = 1
  ) not valid;
-- @destructive: after release 55088f06: that build never writes offer_id, and null values never collide
create unique index document_links_unique_offer_idx
  on public.document_links (document_id, offer_id) where offer_id is not null;
create index document_links_offer_idx
  on public.document_links (organization_id, offer_id) where offer_id is not null;

-- 3. Locks a request for its conversion into p_target ('job', 'project' or
-- 'offer') and returns the work an earlier conversion under p_attempt_key made
-- into that target, or null while the request is open. Refusals:
-- request_not_found, already_converted. Runs as the calling function's owner.
create or replace function app_private.lock_request_for_conversion(
  p_organization_id uuid,
  p_request_id uuid,
  p_attempt_key uuid,
  p_target text
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_work_id uuid;
begin
  select * into v_request from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for update;
  if not found then raise exception 'request_not_found'; end if;
  if v_request.status in ('offen', 'in_klaerung')
    and v_request.converted_job_id is null
    and v_request.converted_project_id is null
    and v_request.converted_offer_id is null
  then
    return null;
  end if;

  v_work_id := case p_target
    when 'job' then v_request.converted_job_id
    when 'project' then v_request.converted_project_id
    when 'offer' then v_request.converted_offer_id
  end;
  if p_attempt_key is not null and v_work_id is not null and exists (
    select 1 from public.client_request_events event
    where event.organization_id = p_organization_id
      and event.request_id = p_request_id
      and event.event_type = 'converted'
      and event.event_payload ->> 'target' = p_target
      and event.event_payload ->> 'attemptKey' = p_attempt_key::text
      and event.event_payload ->> case p_target
        when 'job' then 'jobId' when 'project' then 'projectId' else 'offerId' end
        = v_work_id::text
  ) then
    return v_work_id;
  end if;
  raise exception 'already_converted';
end;
$$;

-- Links each document of the request to the offer, with its audit event. A
-- document already linked to the offer keeps its link.
create function app_private.link_request_documents_to_offer(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_offer_id uuid
)
returns void
language sql
security invoker
set search_path to ''
as $$
  with source_documents as (
    select distinct link.document_id from public.document_links link
    where link.organization_id = p_organization_id and link.request_id = p_request_id
  ),
  added as (
    insert into public.document_links (organization_id, document_id, offer_id, created_by)
    select p_organization_id, source_documents.document_id, p_offer_id, p_actor_id
    from source_documents
    on conflict do nothing
    returning document_id
  )
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  )
  select p_organization_id, added.document_id, p_actor_id, 'linked',
    jsonb_build_object('offerId', p_offer_id, 'requestId', p_request_id, 'via', 'request_conversion')
  from added;
$$;
revoke all on function app_private.link_request_documents_to_offer(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- 4. Converts an open request with a customer into an offer draft of that
-- customer at the chosen Objekt and Ansprechpartner (create_offer), carries a
-- recipient the office chose on the request, marks the request converted,
-- links its documents to the offer and records the 'converted' event with
-- p_attempt_key. A retry under that key returns the offer and writes nothing.
-- Refusals: invalid_input, not_authorized, request_not_found,
-- already_converted, client_required, title_required and those of
-- app_private.check_offer_references.
create function public.convert_client_request_to_offer(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_attempt_key uuid,
  p_title text,
  p_site_id uuid,
  p_contact_id uuid
)
returns public.offers
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_offer public.offers;
  v_offer_id uuid;
  v_parties public.work_billing_parties;
begin
  if p_organization_id is null or p_actor_id is null or p_request_id is null or p_attempt_key is null then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  v_offer_id := app_private.lock_request_for_conversion(p_organization_id, p_request_id, p_attempt_key, 'offer');
  if v_offer_id is not null then
    select * into strict v_offer from public.offers offer
    where offer.organization_id = p_organization_id and offer.id = v_offer_id;
    return v_offer;
  end if;

  select * into strict v_request from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id;
  if v_request.client_id is null then raise exception 'client_required'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'title_required'; end if;

  v_offer_id := public.create_offer(p_actor_id, p_organization_id, p_attempt_key, p_title,
    v_request.client_id, p_site_id, p_contact_id, 'request', p_request_id);

  -- A recipient the office chose on the request carries over while its
  -- customer is not archived, as a conversion into work carries it.
  v_parties := app_private.current_work_billing_parties(p_organization_id, p_request_id);
  if v_parties.id is not null and v_parties.source not in ('objekt', 'auftraggeber') and exists (
    select 1 from public.clients recipient
    where recipient.id = v_parties.recipient_client_id and recipient.organization_id = p_organization_id
      and recipient.archived_at is null
  ) then
    update public.offers offer
    set recipient_client_id = v_parties.recipient_client_id, recipient_is_default = false
    where offer.organization_id = p_organization_id and offer.id = v_offer_id;
  end if;

  update public.client_requests request
  set status = 'umgewandelt', converted_offer_id = v_offer_id, converted_by = p_actor_id,
    converted_at = now()
  where request.organization_id = p_organization_id and request.id = p_request_id;

  perform app_private.link_request_documents_to_offer(p_organization_id, p_actor_id, p_request_id, v_offer_id);

  select * into strict v_offer from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = v_offer_id;
  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, 'converted',
    jsonb_build_object('target', 'offer', 'offerId', v_offer.id, 'offerNumber', v_offer.offer_number,
      'attemptKey', p_attempt_key),
    p_actor_id
  );
  return v_offer;
end;
$$;
revoke all on function public.convert_client_request_to_offer(uuid, uuid, uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.convert_client_request_to_offer(uuid, uuid, uuid, uuid, text, uuid, uuid)
  to service_role;
