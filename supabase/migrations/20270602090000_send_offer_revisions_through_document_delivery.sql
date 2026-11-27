-- The office emails the exact sent revision of an offer once through E2c's
-- delivery, sees its state and retries a failure (werk-flow/werkflow-planning#460,
-- E2c R7). The delivery stays generic (20270310100000_record_document_deliveries.sql,
-- 20270504090000_send_service_reports_through_document_delivery.sql); this adds
-- the subject kind `offer_revision`. E2a's offer and its revisions are only read.
--
-- 1. document_deliveries names a sent revision as its subject: the kind
--    `offer_revision` with offer_revision_id. Each row names exactly one
--    subject. The foreign key needs offer_revisions' (id, organization_id) as
--    a key, which id alone already makes unique.
-- 2. lock_delivery_document sends a revision's own filed PDF while it is its
--    offer's newest revision: once revision n+1 is sent, n is superseded and
--    no send or retry of it is claimed, so the customer never receives a
--    replaced offer from WerkFlow. The offer's lock orders the claim with
--    send_offer, which locks the offer for update before it writes a revision;
--    an attempt claimed before the new revision commits still goes out, as
--    the office pressed „Senden“ on the revision it saw. Each revision is its
--    own subject, so a later revision is a new delivery.
-- 3. request_document_delivery, retry_document_delivery and
--    list_document_deliveries read and write the subject id of each kind;
--    their signatures and answers stay as they are. record_manual_delivery
--    stays as it was: an offer's own „Als gesendet festhalten“ records how it
--    went out, so no manual delivery names a revision (the subject rule
--    refuses one).
--
-- Expand-only: a new nullable column, a key on a column set that is unique
-- already, a wider subject rule, and functions whose earlier calls still
-- resolve. Release 8a73d1d0 writes only invoice deliveries and holds no
-- offer_revisions table.
--
-- Prevention: Tier 1 (the subject rule, the foreign key, the superseded
-- check), Tier 2 supabase/tests/document_deliveries.sql.

-- 1. The subject.
-- @destructive: after release 8a73d1d0: that release has no offer_revisions table, and id alone is its primary key
alter table public.offer_revisions
  add constraint offer_revisions_id_organization_key unique (id, organization_id);

alter table public.document_deliveries add column offer_revision_id uuid;

-- @destructive: after release 8a73d1d0: that release writes only invoice rows, and the new rule below takes every row the old one took
alter table public.document_deliveries drop constraint document_deliveries_subject_check;

-- @destructive: after release 8a73d1d0: every invoice and service report row passes, and only the new column's rows meet the new branch
alter table public.document_deliveries add constraint document_deliveries_subject_check check (
  (subject_kind = 'invoice' and invoice_id is not null and service_report_id is null and offer_revision_id is null)
  or (subject_kind = 'service_report' and service_report_id is not null and invoice_id is null
    and offer_revision_id is null)
  or (subject_kind = 'offer_revision' and offer_revision_id is not null and invoice_id is null
    and service_report_id is null)
) not valid;

-- @destructive: after release 8a73d1d0: the rule binds only the new column, which older code never writes
alter table public.document_deliveries add constraint document_deliveries_offer_revision_fk
  foreign key (offer_revision_id, organization_id)
  references public.offer_revisions (id, organization_id) not valid;

create index document_deliveries_offer_revision_idx
  on public.document_deliveries (offer_revision_id, organization_id, created_at desc)
  where offer_revision_id is not null;

-- 2. The subject's filed document, locked against a concurrent change of the
-- subject. An invoice sends only its own registered original while it is
-- issued (a Stornorechnung is an issued invoice of its own). A service report
-- sends only its own filed document, and only while no newer report of the
-- same visit exists when the attempt is claimed; the visit's lock orders the
-- claim with a regeneration (register_maintenance_service_report). A sent
-- offer revision sends only its own filed PDF, and only while no later
-- revision of the offer exists when the attempt is claimed; the offer's lock
-- orders the claim with send_offer. Refusals: invoice_not_found,
-- invoice_not_issued, service_report_not_found, service_report_stale,
-- offer_revision_not_found, offer_revision_superseded, document_not_found.
create or replace function app_private.lock_delivery_document(
  p_organization_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_document_id uuid
)
returns public.documents
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_invoice public.invoices;
  v_report public.maintenance_service_reports;
  v_revision public.offer_revisions;
  v_document public.documents;
begin
  if p_subject_kind = 'invoice' then
    select * into v_invoice from public.invoices invoice
    where invoice.id = p_subject_id and invoice.organization_id = p_organization_id
    for share;
    if not found then raise exception 'invoice_not_found'; end if;
    if v_invoice.status <> 'ausgestellt' then raise exception 'invoice_not_issued'; end if;
    if v_invoice.original_document_id is distinct from p_document_id then raise exception 'document_not_found'; end if;
  elsif p_subject_kind = 'service_report' then
    select * into v_report from public.maintenance_service_reports report
    where report.id = p_subject_id and report.organization_id = p_organization_id;
    if not found then raise exception 'service_report_not_found'; end if;
    perform 1 from public.maintenance_due_work due_work
    where due_work.id = v_report.maintenance_due_work_id and due_work.organization_id = p_organization_id
    for share;
    if exists (
      select 1 from public.maintenance_service_reports later
      where later.maintenance_due_work_id = v_report.maintenance_due_work_id
        and later.organization_id = p_organization_id and later.report_number > v_report.report_number
    ) then
      raise exception 'service_report_stale';
    end if;
    if v_report.document_id is distinct from p_document_id then raise exception 'document_not_found'; end if;
  elsif p_subject_kind = 'offer_revision' then
    select * into v_revision from public.offer_revisions revision
    where revision.id = p_subject_id and revision.organization_id = p_organization_id;
    if not found then raise exception 'offer_revision_not_found'; end if;
    perform 1 from public.offers offer
    where offer.id = v_revision.offer_id and offer.organization_id = p_organization_id
    for share;
    if exists (
      select 1 from public.offer_revisions later
      where later.offer_id = v_revision.offer_id and later.organization_id = p_organization_id
        and later.revision > v_revision.revision
    ) then
      raise exception 'offer_revision_superseded';
    end if;
    if v_revision.document_id is distinct from p_document_id then raise exception 'document_not_found'; end if;
  else
    raise exception 'invalid_input';
  end if;
  select * into v_document from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id
    and document.deleted_at is null and document.filed_at is not null
    and document.metadata ->> 'contentHash' ~ '^[0-9a-f]{64}$'
  for share;
  if not found then raise exception 'document_not_found'; end if;
  return v_document;
end;
$$;

-- 3. The delivery functions, with the subject id of each kind.

create or replace function public.request_document_delivery(
  p_actor_id uuid,
  p_organization_id uuid,
  p_attempt_key uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_document_id uuid,
  p_recipient_email text,
  p_email_subject text,
  p_message_text text,
  p_sender_name text,
  p_from_header text,
  p_reply_to text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_document public.documents;
  v_delivery public.document_deliveries;
  -- The first attempt's claim, read once the locks are held: a wait for them
  -- shortens neither its ten minutes nor its 23 hours.
  v_claimed_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_attempt_key is null or p_subject_id is null
    or p_document_id is null
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':delivery-attempt:' || p_attempt_key::text, 0));
  select * into v_delivery from public.document_deliveries delivery
  where delivery.organization_id = p_organization_id and delivery.attempt_key = p_attempt_key;
  if found then
    if v_delivery.created_by is distinct from p_actor_id or v_delivery.channel <> 'email'
      or (v_delivery.subject_kind, coalesce(v_delivery.invoice_id, v_delivery.service_report_id, v_delivery.offer_revision_id),
          v_delivery.document_id, v_delivery.recipient_email, v_delivery.email_subject, v_delivery.message_text)
        is distinct from (p_subject_kind, p_subject_id, p_document_id, p_recipient_email, p_email_subject,
          p_message_text)
    then
      raise exception 'invalid_input';
    end if;
    select * into v_document from public.documents document
    where document.id = v_delivery.document_id and document.organization_id = p_organization_id;
    return app_private.delivery_payload(v_delivery, v_document, false);
  end if;

  v_document := app_private.lock_delivery_document(p_organization_id, p_subject_kind, p_subject_id, p_document_id);
  v_claimed_at := clock_timestamp();
  insert into public.document_deliveries (
    organization_id, subject_kind, invoice_id, service_report_id, offer_revision_id, document_id, attachment_content_hash, channel,
    recipient_email, email_subject, message_text, sender_name, from_header, reply_to, state, attempt_key, created_by,
    created_at, updated_at
  ) values (
    p_organization_id, p_subject_kind, case when p_subject_kind = 'invoice' then p_subject_id end,
    case when p_subject_kind = 'service_report' then p_subject_id end,
    case when p_subject_kind = 'offer_revision' then p_subject_id end, p_document_id,
    v_document.metadata ->> 'contentHash', 'email',
    p_recipient_email, p_email_subject, p_message_text, p_sender_name, p_from_header, p_reply_to, 'sending',
    p_attempt_key, p_actor_id, v_claimed_at, v_claimed_at
  )
  returning * into v_delivery;
  insert into public.document_delivery_events (organization_id, delivery_id, event_type, state, attempt, actor_id)
  values (p_organization_id, v_delivery.id, 'requested', 'sending', 1, p_actor_id);
  return app_private.delivery_payload(v_delivery, v_document, true);
exception
  when check_violation then raise exception 'invalid_input';
end;
$$;
revoke all on function public.request_document_delivery(uuid, uuid, uuid, text, uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.request_document_delivery(uuid, uuid, uuid, text, uuid, uuid, text, text, text, text, text, text)
  to service_role;

create or replace function public.retry_document_delivery(
  p_actor_id uuid,
  p_organization_id uuid,
  p_delivery_id uuid,
  p_expected_attempt integer
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_delivery public.document_deliveries;
  v_document public.documents;
  -- The claim's time, read once the locks are held: a wait for them neither
  -- admits a retry past its window nor backdates the attempt it starts.
  v_claimed_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_delivery_id is null or p_expected_attempt is null then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_delivery from public.document_deliveries delivery
  where delivery.id = p_delivery_id and delivery.organization_id = p_organization_id
  for update;
  if not found then raise exception 'delivery_not_found'; end if;
  if v_delivery.channel <> 'email' then raise exception 'delivery_not_retryable'; end if;
  v_document := app_private.lock_delivery_document(
    p_organization_id, v_delivery.subject_kind, coalesce(v_delivery.invoice_id, v_delivery.service_report_id, v_delivery.offer_revision_id),
    v_delivery.document_id);
  v_claimed_at := clock_timestamp();
  if v_delivery.created_at <= v_claimed_at - interval '23 hours' and v_delivery.state <> 'sent' then
    raise exception 'delivery_retry_expired';
  end if;
  if v_delivery.state = 'sent' or v_delivery.attempts <> p_expected_attempt
    or (v_delivery.state = 'sending' and v_delivery.updated_at > v_claimed_at - interval '10 minutes')
  then
    return app_private.delivery_payload(v_delivery, v_document, false);
  end if;

  update public.document_deliveries delivery
  set state = 'sending', attempts = delivery.attempts + 1, failure_code = null,
      outcome_unknown_at = case
        when v_delivery.state = 'sending' then coalesce(delivery.outcome_unknown_at, v_claimed_at)
        else delivery.outcome_unknown_at
      end,
      updated_at = v_claimed_at
  where delivery.id = v_delivery.id and delivery.organization_id = p_organization_id
    and delivery.attempts = v_delivery.attempts
  returning * into v_delivery;
  insert into public.document_delivery_events (organization_id, delivery_id, event_type, state, attempt, actor_id)
  values (p_organization_id, v_delivery.id, 'retried', 'sending', v_delivery.attempts, p_actor_id);
  return app_private.delivery_payload(v_delivery, v_document, true);
end;
$$;
revoke all on function public.retry_document_delivery(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.retry_document_delivery(uuid, uuid, uuid, integer) to service_role;

create or replace function public.list_document_deliveries(
  p_organization_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_limit integer
)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.document_deliveries delivery
      where delivery.organization_id = p_organization_id and delivery.subject_kind = p_subject_kind
        and (delivery.invoice_id = p_subject_id or delivery.service_report_id = p_subject_id
          or delivery.offer_revision_id = p_subject_id)),
    'rows', coalesce((
      select jsonb_agg(row_data order by created_at desc, id desc)
      from (
        select delivery.created_at, delivery.id, jsonb_build_object(
          'id', delivery.id,
          'channel', delivery.channel,
          'state', delivery.state,
          'recipient', delivery.recipient_email,
          'subject', delivery.email_subject,
          'note', delivery.note,
          'attempts', delivery.attempts,
          'failureCode', delivery.failure_code,
          'outcomeUnknown', delivery.outcome_unknown_at is not null,
          'createdAt', delivery.created_at,
          'sentAt', delivery.dispatched_at,
          'createdBy', nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
          'retryFrom', case
            when delivery.channel = 'email' and delivery.state = 'failed' then delivery.updated_at
            when delivery.channel = 'email' and delivery.state = 'sending'
              then delivery.updated_at + interval '10 minutes'
          end,
          'retryUntil', case
            when delivery.channel = 'email' and delivery.state <> 'sent'
              then delivery.created_at + interval '23 hours'
          end
        ) as row_data
        from public.document_deliveries delivery
        left join public.profiles profile on profile.id = delivery.created_by
        where delivery.organization_id = p_organization_id and delivery.subject_kind = p_subject_kind
          and (delivery.invoice_id = p_subject_id or delivery.service_report_id = p_subject_id
          or delivery.offer_revision_id = p_subject_id)
        order by delivery.created_at desc, delivery.id desc
        limit greatest(1, least(p_limit, 200))
      ) page
    ), '[]')
  );
$$;
revoke all on function public.list_document_deliveries(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_document_deliveries(uuid, text, uuid, integer) to service_role;
