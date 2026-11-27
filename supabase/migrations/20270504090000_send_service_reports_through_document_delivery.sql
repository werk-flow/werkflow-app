-- The office emails a Servicebericht once through E2c's delivery, sees its
-- state, retries a failure and records a manual send
-- (werk-flow/werkflow-planning#472, E11 S7). The delivery stays E2c's
-- generic module (20270310100000_record_document_deliveries.sql); this adds
-- a subject kind, nothing of its own.
--
-- 1. document_deliveries names a service report as its subject: the kind
--    `service_report` with service_report_id, beside the invoice kind with
--    invoice_id. Each row names exactly one subject.
-- 2. lock_delivery_document sends a report's own filed document while it is
--    the visit's latest report: a report the office has regenerated since is
--    stale, so no send or retry of an older version is claimed. The claim is
--    the cutoff: an attempt claimed before a regeneration commits still goes
--    out, as the office pressed „Senden“ on the report it saw.
-- 3. request_document_delivery, retry_document_delivery,
--    record_manual_delivery and list_document_deliveries read and write the
--    subject id of either kind; their signatures and answers stay as they are.
-- 4. register_maintenance_service_report records the report PDF's content
--    hash in the document's metadata, as an issued invoice's original
--    carries it, so the delivery can check that it attaches the filed bytes.
--    A report filed without it cannot be sent; „Neu erstellen“ files one
--    that can.
--
-- Expand-only: a new nullable column, a wider subject rule, and functions
-- whose earlier calls still resolve. Release 55088f06 holds neither the
-- delivery table nor the service report function.
--
-- Prevention: Tier 1 (the subject rule, the foreign key, the stale check),
-- Tier 2 supabase/tests/document_deliveries.sql and
-- supabase/tests/maintenance_service_reports.sql.

-- 1. The subject.
alter table public.document_deliveries add column service_report_id uuid;

-- @destructive: after release 55088f06: that release has no document_deliveries table; the new rule below takes every row the old one took
alter table public.document_deliveries drop constraint document_deliveries_subject_check;

-- @destructive: after release 55088f06: that release has no document_deliveries table; every invoice row passes, and only the new column's rows meet the new branch
alter table public.document_deliveries add constraint document_deliveries_subject_check check (
  (subject_kind = 'invoice' and invoice_id is not null and service_report_id is null)
  or (subject_kind = 'service_report' and service_report_id is not null and invoice_id is null)
) not valid;

-- @destructive: after release 55088f06: that release has no document_deliveries table; the rule binds only the new column, which older code never writes
alter table public.document_deliveries add constraint document_deliveries_service_report_fk
  foreign key (service_report_id, organization_id)
  references public.maintenance_service_reports (id, organization_id) not valid;

create index document_deliveries_service_report_idx
  on public.document_deliveries (service_report_id, organization_id, created_at desc)
  where service_report_id is not null;

-- 2. The subject's filed document, locked against a concurrent change of the
-- subject. An invoice sends only its own registered original while it is
-- issued (a Stornorechnung is an issued invoice of its own). A service report
-- sends only its own filed document, and only while no newer report of the
-- same visit exists when the attempt is claimed; the visit's lock orders the
-- claim with a regeneration, which takes that lock too
-- (register_maintenance_service_report). Refusals:
-- invoice_not_found, invoice_not_issued, service_report_not_found,
-- service_report_stale, document_not_found.
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

-- 3. The delivery functions, with the subject id of either kind.

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
      or (v_delivery.subject_kind, coalesce(v_delivery.invoice_id, v_delivery.service_report_id),
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
    organization_id, subject_kind, invoice_id, service_report_id, document_id, attachment_content_hash, channel,
    recipient_email, email_subject, message_text, sender_name, from_header, reply_to, state, attempt_key, created_by,
    created_at, updated_at
  ) values (
    p_organization_id, p_subject_kind, case when p_subject_kind = 'invoice' then p_subject_id end,
    case when p_subject_kind = 'service_report' then p_subject_id end, p_document_id,
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
    p_organization_id, v_delivery.subject_kind, coalesce(v_delivery.invoice_id, v_delivery.service_report_id),
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

create or replace function public.record_manual_delivery(
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
      or (v_delivery.subject_kind, coalesce(v_delivery.invoice_id, v_delivery.service_report_id), v_delivery.document_id,
          v_delivery.note)
        is distinct from (p_subject_kind, p_subject_id, p_document_id, p_note)
    then
      raise exception 'invalid_input';
    end if;
    return v_delivery.id;
  end if;

  v_document := app_private.lock_delivery_document(p_organization_id, p_subject_kind, p_subject_id, p_document_id);
  insert into public.document_deliveries (
    organization_id, subject_kind, invoice_id, service_report_id, document_id, attachment_content_hash, channel, note,
    state,
    attempt_key, created_by, dispatched_at
  ) values (
    p_organization_id, p_subject_kind, case when p_subject_kind = 'invoice' then p_subject_id end,
    case when p_subject_kind = 'service_report' then p_subject_id end, p_document_id,
    v_document.metadata ->> 'contentHash', 'manual', p_note, 'sent', p_attempt_key, p_actor_id, now()
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
        and (delivery.invoice_id = p_subject_id or delivery.service_report_id = p_subject_id)),
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
          and (delivery.invoice_id = p_subject_id or delivery.service_report_id = p_subject_id)
        order by delivery.created_at desc, delivery.id desc
        limit greatest(1, least(p_limit, 200))
      ) page
    ), '[]')
  );
$$;
revoke all on function public.list_document_deliveries(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_document_deliveries(uuid, text, uuid, integer) to service_role;

-- 4. „Servicebericht erstellen“ records the PDF's content hash. The earlier
-- signature goes; its calls resolve to this one, which defaults the hash.
-- @destructive: after release 55088f06: that release has no service report function; the replacement keeps every argument of this one in place and defaults the new one, so earlier calls resolve to it
drop function public.register_maintenance_service_report(uuid, uuid, uuid, uuid, uuid, uuid, text, text, bigint);

-- As before, and the document's metadata names the PDF's content hash when
-- the caller passes it (lib/service-reports/report-file.ts always does).
create function public.register_maintenance_service_report(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_id uuid,
  p_maintenance_due_work_id uuid,
  p_replaces_report_id uuid,
  p_document_id uuid,
  p_storage_path text,
  p_file_name text,
  p_size_bytes bigint,
  p_content_hash text default null
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_existing public.maintenance_service_reports%rowtype;
  v_due public.maintenance_due_work%rowtype;
  v_latest public.maintenance_service_reports%rowtype;
  v_client_id uuid;
  v_name text := btrim(coalesce(p_file_name, ''));
  v_counter integer := 0;
  v_constraint text;
begin
  if not app_private.maintenance_actor_is_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  if p_report_id is null or p_document_id is null
     or p_storage_path is null or split_part(p_storage_path, '/', 1) <> p_organization_id::text
     or right(p_storage_path, 4) <> '.pdf'
     or length(v_name) not between 5 and 240 or right(v_name, 4) <> '.pdf'
     or p_size_bytes is null or p_size_bytes <= 0
     or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_input';
  end if;

  -- The lock orders two reports of one visit, and a retry after its attempt.
  select * into v_due from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id
  for update;
  if not found then raise exception 'maintenance_due_not_found'; end if;
  -- After the lock, so a retry that overlapped the committing attempt finds it.
  select * into v_existing from public.maintenance_service_reports report
  where report.id = p_report_id;
  if found then
    if v_existing.organization_id <> p_organization_id
       or v_existing.maintenance_due_work_id <> p_maintenance_due_work_id then
      raise exception 'service_report_idempotency_conflict';
    end if;
    return jsonb_build_object('reportId', v_existing.id, 'documentId', v_existing.document_id, 'duplicate', true);
  end if;

  if v_due.status <> 'completed' or v_due.job_id is null then
    raise exception 'service_report_visit_not_completed';
  end if;
  select * into v_latest from public.maintenance_service_reports report
  where report.maintenance_due_work_id = v_due.id and report.organization_id = p_organization_id
  order by report.report_number desc
  limit 1;
  if v_latest.id is distinct from p_replaces_report_id then raise exception 'service_report_stale'; end if;
  select plan.client_id into strict v_client_id from public.maintenance_plans plan
  where plan.id = v_due.maintenance_plan_id and plan.organization_id = p_organization_id;

  -- Reports land in the library root, where an active name is unique: the
  -- first free `name (n).pdf`, as the library names a copy.
  while exists (
    select 1 from public.documents document
    where document.organization_id = p_organization_id and document.folder_id is null
      and document.deleted_at is null and lower(btrim(document.display_name)) = lower(v_name)
  ) loop
    v_counter := v_counter + 1;
    v_name := left(btrim(p_file_name), -4) || ' (' || v_counter || ').pdf';
  end loop;

  -- A report of another item of the same job may take the name meanwhile:
  -- then the next free name, as long as the library refuses only the name.
  loop
    begin
      insert into public.documents (
        id, organization_id, folder_id, storage_bucket, storage_path,
        original_file_name, display_name, category, mime_type, size_bytes,
        uploaded_by, metadata
      ) values (
        p_document_id, p_organization_id, null, 'organization-documents', p_storage_path,
        v_name, v_name, 'report', 'application/pdf', p_size_bytes,
        p_actor_id, jsonb_strip_nulls(jsonb_build_object('maintenanceServiceReportId', p_report_id,
          'maintenanceDueWorkId', v_due.id, 'contentHash', p_content_hash))
      );
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'documents_unique_active_folder_name_idx' then raise; end if;
      v_counter := v_counter + 1;
      v_name := left(btrim(p_file_name), -4) || ' (' || v_counter || ').pdf';
    end;
  end loop;
  insert into public.document_links (organization_id, document_id, job_id, created_by)
  values (p_organization_id, p_document_id, v_due.job_id, p_actor_id);
  insert into public.document_links (organization_id, document_id, equipment_id, created_by)
  select p_organization_id, p_document_id, link.equipment_id, p_actor_id
  from public.maintenance_plan_revision_equipment link
  where link.maintenance_plan_revision_id = v_due.maintenance_plan_revision_id
    and link.organization_id = p_organization_id;
  insert into public.document_links (organization_id, document_id, client_id, created_by)
  values (p_organization_id, p_document_id, v_client_id, p_actor_id);
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_actor_id, 'uploaded',
    jsonb_build_object('source', 'maintenance_service_report',
      'maintenanceServiceReportId', p_report_id, 'maintenanceDueWorkId', v_due.id,
      'storagePath', p_storage_path)
  );
  insert into public.maintenance_service_reports (
    id, organization_id, maintenance_due_work_id, document_id, report_number,
    replaces_report_id, created_by
  ) values (
    p_report_id, p_organization_id, v_due.id, p_document_id,
    coalesce(v_latest.report_number, 0) + 1, v_latest.id, p_actor_id
  );
  -- Filed in the same call through E9's filing, so no report stands unfiled.
  perform public.file_document(p_actor_id, p_organization_id, p_document_id);
  return jsonb_build_object('reportId', p_report_id, 'documentId', p_document_id, 'duplicate', false);
end;
$$;


revoke all on function public.register_maintenance_service_report(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.register_maintenance_service_report(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, bigint, text
) to service_role;
