-- The office sends a filed document once, sees whether it went out, retries a
-- failure and records a send by post or by hand (werk-flow/werkflow-planning#458,
-- E2c R5). Generic over the sent document: an issued invoice's original now,
-- an offer revision and a service report later, each a subject kind.
--
-- 1. document_deliveries: one row per delivery. It names its subject and the
--    exact attachment (the filed document and its content hash), the channel
--    (email, or manual with the office's note), what an email carried
--    (recipient, subject, text, sender name, Reply-To) and its state: sending,
--    sent with the provider's message id, or failed with a stable code. The
--    row id is the transport's idempotency key, and a retry sends the stored
--    content again, so a retried or replayed send delivers once.
-- 2. document_delivery_events: the append-only history of each delivery.
-- 3. request_document_delivery, retry_document_delivery and
--    settle_document_delivery: an email is recorded as sending before the
--    server hands it to the transport, and settled with the answer.
--    record_manual_delivery: a delivery the office made itself.
--    list_document_deliveries: the server's read of a subject's deliveries.
--
-- Division of work: lib/delivery/ establishes identity, role and
-- organization, passes the rate limit, reads the attachment and checks its
-- hash, and sends through lib/delivery/send-email.ts. Each write function
-- checks the actor again under the access lock (app_private.lock_office_actor)
-- and refuses a subject or document outside the organization, or a document
-- that is not the subject's own.
--
-- A manager's session reads only the row's id, subject and state, to hear of
-- a change; a field worker reads no row. Bounce and complaint signals arrive
-- later through the shared signed webhook route (werk-flow/werkflow-planning#496).
--
-- Expand-only: new tables and functions.
--
-- Prevention: Tier 1 (constraints, the ledger guard, grants), Tier 2
-- supabase/tests/document_deliveries.sql.

-- 1. The deliveries.
create table public.document_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subject_kind text not null,
  invoice_id uuid,
  -- The exact attachment: a filed document of the subject, and its content hash.
  document_id uuid not null,
  attachment_content_hash text not null,
  channel text not null,
  -- What an email carried; a manual delivery has none of it.
  recipient_email text,
  email_subject text,
  message_text text,
  sender_name text,
  reply_to text,
  -- How a manual delivery went out, in the office's words.
  note text not null default '',
  state text not null,
  attempts integer not null default 1,
  provider_message_id text,
  failure_code text,
  attempt_key uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint document_deliveries_id_organization_key unique (id, organization_id),
  constraint document_deliveries_attempt_unique unique (organization_id, attempt_key),
  constraint document_deliveries_subject_check check (subject_kind = 'invoice' and invoice_id is not null),
  constraint document_deliveries_hash_check check (attachment_content_hash ~ '^[0-9a-f]{64}$'),
  constraint document_deliveries_channel_check check (
    (channel = 'email'
      and num_nonnulls(recipient_email, email_subject, message_text, sender_name) = 4
      and recipient_email ~ '^[^@\s<>,;"]{1,64}@[^@\s<>,;"]{1,255}$'
      and btrim(email_subject) <> '' and char_length(email_subject) <= 200
      and char_length(message_text) <= 5000
      and btrim(sender_name) <> '' and char_length(sender_name) <= 200
      and (reply_to is null or reply_to ~ '^[^@\s<>,;"]{1,64}@[^@\s<>,;"]{1,255}$')
      and note = '')
    or (channel = 'manual'
      and num_nulls(recipient_email, email_subject, message_text, sender_name, reply_to) = 5
      and state = 'sent' and char_length(note) <= 500)
  ),
  constraint document_deliveries_state_check check (state in ('sending', 'sent', 'failed')),
  constraint document_deliveries_sent_check check ((state = 'sent') = (sent_at is not null)),
  constraint document_deliveries_failed_check check (
    (state = 'failed') = (failure_code is not null) and failure_code ~ '^[a-z0-9_]{1,64}$'
  ),
  constraint document_deliveries_message_check check (
    (channel = 'email' and state = 'sent') = (provider_message_id is not null)
    and provider_message_id ~ '^[A-Za-z0-9_.:-]{1,128}$'
  ),
  constraint document_deliveries_attempts_check check (attempts between 1 and 1000),
  constraint document_deliveries_invoice_fk foreign key (invoice_id, organization_id)
    references public.invoices (id, organization_id),
  constraint document_deliveries_document_fk foreign key (document_id, organization_id)
    references public.documents (id, organization_id)
);

create unique index document_deliveries_replident_idx on public.document_deliveries (id, organization_id);
create index document_deliveries_invoice_idx on public.document_deliveries (invoice_id, organization_id, created_at desc)
  where invoice_id is not null;
create index document_deliveries_document_idx on public.document_deliveries (document_id, organization_id);
create index document_deliveries_created_by_idx on public.document_deliveries (created_by);

-- A manager's session hears of a change through the id, subject and state;
-- the server reads and writes the rest.
alter table public.document_deliveries enable row level security;
create policy "Managers can view document deliveries in their orgs" on public.document_deliveries
  for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
revoke all on table public.document_deliveries from public, anon, authenticated, service_role;
grant select (id, organization_id, subject_kind, invoice_id, state, updated_at)
  on table public.document_deliveries to authenticated;
grant select, insert, update on table public.document_deliveries to service_role;

alter table public.document_deliveries replica identity using index document_deliveries_replident_idx;
alter publication supabase_realtime add table public.document_deliveries;
create trigger emit_realtime_deletion after delete on public.document_deliveries
  for each row execute function app_private.emit_realtime_deletion();

-- 2. The history.
create table public.document_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  delivery_id uuid not null,
  event_type text not null,
  -- The delivery's state and attempt after the event.
  state text not null,
  attempt integer not null,
  failure_code text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint document_delivery_events_type_check check (
    event_type in ('requested', 'retried', 'sent', 'failed', 'recorded_manual')
  ),
  constraint document_delivery_events_state_check check (state in ('sending', 'sent', 'failed')),
  constraint document_delivery_events_failure_check check (failure_code ~ '^[a-z0-9_]{1,64}$'),
  constraint document_delivery_events_delivery_fk foreign key (delivery_id, organization_id)
    references public.document_deliveries (id, organization_id) on delete cascade
);

create index document_delivery_events_delivery_idx
  on public.document_delivery_events (delivery_id, organization_id, created_at);
create index document_delivery_events_actor_id_idx on public.document_delivery_events (actor_id);

alter table public.document_delivery_events enable row level security;
revoke all on table public.document_delivery_events from public, anon, authenticated, service_role;
grant select, insert on table public.document_delivery_events to service_role;

create trigger guard_event_ledger_history before update or delete on public.document_delivery_events
  for each row execute function app_private.guard_event_ledger_history();

-- 3. The subject's filed document, locked against a concurrent change of the
-- subject. An invoice sends only its own registered original while it is
-- issued (a Stornorechnung is an issued invoice of its own). Refusals:
-- invoice_not_found, invoice_not_issued, document_not_found.
create function app_private.lock_delivery_document(
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
  v_document public.documents;
begin
  if p_subject_kind is distinct from 'invoice' then raise exception 'invalid_input'; end if;
  select * into v_invoice from public.invoices invoice
  where invoice.id = p_subject_id and invoice.organization_id = p_organization_id
  for share;
  if not found then raise exception 'invoice_not_found'; end if;
  if v_invoice.status <> 'ausgestellt' then raise exception 'invoice_not_issued'; end if;
  if v_invoice.original_document_id is distinct from p_document_id then raise exception 'document_not_found'; end if;
  select * into v_document from public.documents document
  where document.id = p_document_id and document.organization_id = p_organization_id
    and document.deleted_at is null and document.filed_at is not null
    and document.metadata ->> 'contentHash' ~ '^[0-9a-f]{64}$'
  for share;
  if not found then raise exception 'document_not_found'; end if;
  return v_document;
end;
$$;
revoke all on function app_private.lock_delivery_document(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.lock_delivery_document(uuid, text, uuid, uuid) to service_role;

-- What the server needs to send a delivery: its stored content, the
-- attachment's storage path, file name, type and hash, and the attempt to settle.
create function app_private.delivery_payload(
  p_delivery public.document_deliveries,
  p_document public.documents,
  p_claimed boolean
)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  select jsonb_build_object(
    'deliveryId', p_delivery.id,
    'claimed', p_claimed,
    'state', p_delivery.state,
    'attempt', p_delivery.attempts,
    'recipient', p_delivery.recipient_email,
    'subject', p_delivery.email_subject,
    'text', p_delivery.message_text,
    'senderName', p_delivery.sender_name,
    'replyTo', p_delivery.reply_to,
    'storagePath', p_document.storage_path,
    'fileName', p_document.original_file_name,
    'contentType', coalesce(p_document.mime_type, 'application/pdf'),
    'contentHash', p_delivery.attachment_content_hash
  );
$$;
revoke all on function app_private.delivery_payload(public.document_deliveries, public.documents, boolean)
  from public, anon, authenticated;
grant execute on function app_private.delivery_payload(public.document_deliveries, public.documents, boolean)
  to service_role;

-- Records an email delivery as sending and answers its payload with claimed
-- true: the caller sends it under the delivery id and settles the attempt. A
-- repeat under the same attempt key answers the first delivery with claimed
-- false and sends nothing. Refusals: invalid_input, not_authorized and those
-- of lock_delivery_document.
create function public.request_document_delivery(
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
      or (v_delivery.subject_kind, v_delivery.invoice_id, v_delivery.document_id, v_delivery.recipient_email,
          v_delivery.email_subject, v_delivery.message_text)
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
  insert into public.document_deliveries (
    organization_id, subject_kind, invoice_id, document_id, attachment_content_hash, channel,
    recipient_email, email_subject, message_text, sender_name, reply_to, state, attempt_key, created_by
  ) values (
    p_organization_id, p_subject_kind, p_subject_id, p_document_id, v_document.metadata ->> 'contentHash', 'email',
    p_recipient_email, p_email_subject, p_message_text, p_sender_name, p_reply_to, 'sending', p_attempt_key,
    p_actor_id
  )
  returning * into v_delivery;
  insert into public.document_delivery_events (organization_id, delivery_id, event_type, state, attempt, actor_id)
  values (p_organization_id, v_delivery.id, 'requested', 'sending', 1, p_actor_id);
  return app_private.delivery_payload(v_delivery, v_document, true);
exception
  when check_violation then raise exception 'invalid_input';
end;
$$;
revoke all on function public.request_document_delivery(uuid, uuid, uuid, text, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.request_document_delivery(uuid, uuid, uuid, text, uuid, uuid, text, text, text, text, text)
  to service_role;

-- Claims a failed email delivery for another attempt, or one whose attempt
-- has been sending for ten minutes (its process ended without an answer),
-- and answers its payload with claimed true. A sent delivery, one that is
-- sending now, or one whose attempt is no longer p_expected_attempt (a
-- repeated press) answers claimed false and is not sent again. A delivery
-- requested 23 hours ago or earlier is not retried: the provider keeps the
-- idempotency key 24 hours from the first attempt, so a later retry could
-- deliver a mail whose acceptance was lost a second time. Refusals:
-- not_authorized, delivery_not_found, delivery_not_retryable,
-- delivery_retry_expired, and the document's when the subject no longer
-- sends it.
create function public.retry_document_delivery(
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
  if v_delivery.created_at <= now() - interval '23 hours' and v_delivery.state <> 'sent' then
    raise exception 'delivery_retry_expired';
  end if;
  v_document := app_private.lock_delivery_document(
    p_organization_id, v_delivery.subject_kind, v_delivery.invoice_id, v_delivery.document_id);
  if v_delivery.state = 'sent' or v_delivery.attempts <> p_expected_attempt
    or (v_delivery.state = 'sending' and v_delivery.updated_at > now() - interval '10 minutes')
  then
    return app_private.delivery_payload(v_delivery, v_document, false);
  end if;

  update public.document_deliveries delivery
  set state = 'sending', attempts = delivery.attempts + 1, failure_code = null, updated_at = now()
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

-- Ends one attempt: sent with the provider's message id, or failed with a
-- stable code. Only the attempt that is sending settles; a sent delivery
-- never changes, and a late answer of an older attempt answers false.
create function public.settle_document_delivery(
  p_actor_id uuid,
  p_organization_id uuid,
  p_delivery_id uuid,
  p_attempt integer,
  p_outcome text,
  p_provider_message_id text default null,
  p_failure_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_delivery public.document_deliveries;
begin
  if p_organization_id is null or p_delivery_id is null or p_attempt is null
    or p_outcome is null or p_outcome not in ('sent', 'failed')
    or (p_outcome = 'sent') is distinct from (p_provider_message_id is not null)
    or (p_outcome = 'failed') is distinct from (p_failure_code is not null)
  then
    raise exception 'invalid_input';
  end if;
  update public.document_deliveries delivery
  set state = p_outcome,
      provider_message_id = p_provider_message_id,
      failure_code = p_failure_code,
      sent_at = case when p_outcome = 'sent' then now() end,
      updated_at = now()
  where delivery.id = p_delivery_id and delivery.organization_id = p_organization_id
    and delivery.channel = 'email' and delivery.state = 'sending' and delivery.attempts = p_attempt
  returning * into v_delivery;
  if not found then return false; end if;
  insert into public.document_delivery_events (
    organization_id, delivery_id, event_type, state, attempt, failure_code, actor_id
  ) values (
    p_organization_id, v_delivery.id, p_outcome, p_outcome, p_attempt, p_failure_code, p_actor_id
  );
  return true;
exception
  when check_violation then raise exception 'invalid_input';
end;
$$;
revoke all on function public.settle_document_delivery(uuid, uuid, uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_document_delivery(uuid, uuid, uuid, integer, text, text, text)
  to service_role;

-- Records a delivery the office made by post or by hand: sent, manual, with
-- its note, of the subject's document. A repeat under the same attempt key
-- answers the first delivery. Refusals: invalid_input, not_authorized and
-- those of lock_delivery_document.
create function public.record_manual_delivery(
  p_actor_id uuid,
  p_organization_id uuid,
  p_attempt_key uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_document_id uuid,
  p_note text
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_document public.documents;
  v_delivery public.document_deliveries;
begin
  if p_actor_id is null or p_organization_id is null or p_attempt_key is null or p_subject_id is null
    or p_document_id is null or p_note is null
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':delivery-attempt:' || p_attempt_key::text, 0));
  select * into v_delivery from public.document_deliveries delivery
  where delivery.organization_id = p_organization_id and delivery.attempt_key = p_attempt_key;
  if found then
    if v_delivery.created_by is distinct from p_actor_id or v_delivery.channel <> 'manual'
      or (v_delivery.subject_kind, v_delivery.invoice_id, v_delivery.document_id, v_delivery.note)
        is distinct from (p_subject_kind, p_subject_id, p_document_id, p_note)
    then
      raise exception 'invalid_input';
    end if;
    return v_delivery.id;
  end if;

  v_document := app_private.lock_delivery_document(p_organization_id, p_subject_kind, p_subject_id, p_document_id);
  insert into public.document_deliveries (
    organization_id, subject_kind, invoice_id, document_id, attachment_content_hash, channel, note, state,
    attempt_key, created_by, sent_at
  ) values (
    p_organization_id, p_subject_kind, p_subject_id, p_document_id, v_document.metadata ->> 'contentHash',
    'manual', p_note, 'sent', p_attempt_key, p_actor_id, now()
  )
  returning * into v_delivery;
  insert into public.document_delivery_events (organization_id, delivery_id, event_type, state, attempt, actor_id)
  values (p_organization_id, v_delivery.id, 'recorded_manual', 'sent', 1, p_actor_id);
  return v_delivery.id;
exception
  when check_violation then raise exception 'invalid_input';
end;
$$;
revoke all on function public.record_manual_delivery(uuid, uuid, uuid, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_manual_delivery(uuid, uuid, uuid, text, uuid, uuid, text)
  to service_role;

-- A subject's deliveries, newest first, at most p_limit with the total, so
-- the page names what it leaves out. retryable: failed, or sending for ten
-- minutes without an answer, and requested less than 23 hours ago.
create function public.list_document_deliveries(
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
        and delivery.invoice_id = p_subject_id),
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
          'createdAt', delivery.created_at,
          'sentAt', delivery.sent_at,
          'createdBy', nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
          'retryable', delivery.channel = 'email' and delivery.created_at > now() - interval '23 hours'
            and (delivery.state = 'failed'
              or (delivery.state = 'sending' and delivery.updated_at <= now() - interval '10 minutes'))
        ) as row_data
        from public.document_deliveries delivery
        left join public.profiles profile on profile.id = delivery.created_by
        where delivery.organization_id = p_organization_id and delivery.subject_kind = p_subject_kind
          and delivery.invoice_id = p_subject_id
        order by delivery.created_at desc, delivery.id desc
        limit greatest(1, least(p_limit, 200))
      ) page
    ), '[]')
  );
$$;
revoke all on function public.list_document_deliveries(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_document_deliveries(uuid, text, uuid, integer) to service_role;
