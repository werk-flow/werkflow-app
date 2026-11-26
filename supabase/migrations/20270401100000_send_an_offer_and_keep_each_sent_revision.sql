-- The office records an offer as sent, and every sent revision stays as it was
-- (werk-flow/werkflow-planning#383, E2a K7).
--
-- 1. offer_revisions: one row per sent revision, frozen. It keeps what the
--    PDF printed: number, title, validity, the day it was sent and the
--    channel the office named, the Auftraggeber and the Rechnungsempfänger
--    with the recipient's name and address as they were, the sender's company
--    profile and the Einsatzort as rendered (`snapshot`), and the Titel and
--    Positionen with their amounts (`content`, built here from the draft's
--    rows), with the rendered PDF as a filed document. A guard refuses every
--    change and delete, whoever writes, but a deleted person's set null and
--    the organization's teardown.
-- 2. send_offer: in one transaction it checks the draft is still at the
--    versions the server rendered, registers the PDF the server stored as a
--    document of category offer in the ten-year class under the first free
--    name of the library root, linked to the offer and its customer and to
--    nothing else, files it, writes the revision,
--    sets „Gesendet“ and writes the history entry with the channel. A refusal
--    rolls back everything; the server then discards its stored bytes. A
--    repeated press, also from another tab on the same draft, answers the
--    first revision and registers nothing.
-- 3. guard_offer_revision_links: no link is added to a sent revision's
--    document or to a copy of it afterwards, so no job or project link opens
--    it to that work's employees.
-- 4. list_offer_revisions: the server's read of an offer's revisions.
--
-- WerkFlow sends nothing: the channel is what the office says it used.
--
-- Division of work: lib/offers/sending.ts establishes identity, the manager
-- role and the organization, reads the offer and the company profile,
-- renders and stores the PDF, and passes the rendered recipient and sender;
-- the function checks the actor again under the access lock.
--
-- Expand-only: a new table and new functions and a new trigger;
-- document_links gains a guard that only refuses links to the new
-- revisions' documents, which no earlier build writes.
--
-- Prevention: Tier 1 (the guards, the checks, no client grant), Tier 2
-- supabase/tests/offer_sending.sql.

-- 1. The sent revisions.
create table public.offer_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offer_id uuid not null,
  revision integer not null,
  offer_number text not null,
  title text not null,
  valid_until date not null,
  -- The Berlin day the PDF is dated and the office recorded it as sent.
  sent_on date not null,
  -- download, email (from the office's own mailbox), post or persoenlich.
  channel text not null,
  client_id uuid not null,
  recipient_client_id uuid not null,
  recipient_name text not null,
  recipient_address text,
  -- The sender's company profile with its letterhead files and the Einsatzort, as rendered.
  snapshot jsonb not null,
  -- Titel in order, each with its Positionen and amounts, as stored at sending.
  content jsonb not null,
  net_cents bigint not null,
  tax_cents bigint not null,
  gross_cents bigint not null,
  document_id uuid not null,
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint offer_revisions_offer_fk foreign key (offer_id, organization_id)
    references public.offers (id, organization_id) on delete cascade,
  constraint offer_revisions_client_fk foreign key (client_id, organization_id)
    references public.clients (id, organization_id),
  constraint offer_revisions_recipient_fk foreign key (recipient_client_id, organization_id)
    references public.clients (id, organization_id),
  constraint offer_revisions_document_fk foreign key (document_id, organization_id)
    references public.documents (id, organization_id),
  constraint offer_revisions_revision_unique unique (offer_id, revision),
  constraint offer_revisions_document_unique unique (document_id),
  constraint offer_revisions_revision_check check (revision >= 1),
  constraint offer_revisions_channel_check check (channel in ('download', 'email', 'post', 'persoenlich')),
  constraint offer_revisions_recipient_check check (btrim(recipient_name) <> ''),
  constraint offer_revisions_json_check check (
    jsonb_typeof(snapshot) = 'object' and jsonb_typeof(content) = 'array'
  )
);

create index offer_revisions_offer_idx on public.offer_revisions (offer_id, organization_id, revision desc);
create index offer_revisions_organization_id_fk_idx on public.offer_revisions (organization_id);
create index offer_revisions_client_idx on public.offer_revisions (client_id, organization_id);
create index offer_revisions_recipient_idx on public.offer_revisions (recipient_client_id, organization_id);
create index offer_revisions_document_idx on public.offer_revisions (document_id, organization_id);
create index offer_revisions_sent_by_idx on public.offer_revisions (sent_by);

-- The server reads and writes the revisions; no signed-in role reads a row,
-- because the content keeps each Position's hidden purchase cost.
alter table public.offer_revisions enable row level security;
revoke all on table public.offer_revisions from public, anon, authenticated, service_role;
grant select, insert on table public.offer_revisions to service_role;

-- No update, no delete: only a foreign key's set null or cascade passes.
create trigger guard_event_ledger_history before update or delete on public.offer_revisions
  for each row execute function app_private.guard_event_ledger_history();

-- 3. A sent revision's document keeps the offer and customer links send_offer
-- wrote: a work link would let every employee assigned to that work read it.
-- So no link is added to it, or to a library copy made from it, and no link of
-- either turns to another target, whoever writes; a removal and a deleted target's set null stay. send_offer
-- links before it writes the revision, in one transaction, so the refusal
-- never meets it. Security definer as the invoice original's link guard: no
-- role executes it.
create function app_private.guard_offer_revision_links()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' and new.document_id = old.document_id
    and (new.job_id is null or new.job_id is not distinct from old.job_id)
    and (new.project_id is null or new.project_id is not distinct from old.project_id)
    and (new.client_id is null or new.client_id is not distinct from old.client_id)
    and (new.employee_id is null or new.employee_id is not distinct from old.employee_id)
    and (new.request_id is null or new.request_id is not distinct from old.request_id)
    and (new.equipment_id is null or new.equipment_id is not distinct from old.equipment_id)
    and (new.service_case_id is null or new.service_case_id is not distinct from old.service_case_id)
    and (new.maintenance_coverage_id is null
      or new.maintenance_coverage_id is not distinct from old.maintenance_coverage_id)
    and (new.offer_id is null or new.offer_id is not distinct from old.offer_id)
  then
    return new;
  end if;
  -- The document itself, or the original a library copy (of a copy) was made from.
  if exists (
    with recursive copied (document_id) as (
      select new.document_id
      union
      select document.copied_from_document_id from public.documents document
      join copied on copied.document_id = document.id
      where document.organization_id = new.organization_id and document.copied_from_document_id is not null
    )
    select 1 from public.offer_revisions revision
    join copied on copied.document_id = revision.document_id
    where revision.organization_id = new.organization_id
  ) then
    raise exception 'document_is_offer_original';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_offer_revision_links() from public, anon, authenticated, service_role;
create trigger guard_offer_revision_links before insert or update on public.document_links
  for each row execute function app_private.guard_offer_revision_links();

-- 2. Records the draft p_offer_id as sent through p_channel, as revision n.
-- p_expected_version and p_expected_content_version are the header and
-- content versions the server read and rendered; p_sent_on is the Berlin day
-- the PDF is dated. p_recipient_name and p_recipient_address are the
-- Rechnungsempfänger as the PDF printed them, p_snapshot the sender's profile
-- and the Einsatzort as rendered. The p_document_* arguments name the PDF the
-- server stored under its own document id. The answer is
-- {revision, documentId, replay}: a call under the attempt key of an earlier
-- send, or any send of a draft already sent at the same versions, answers
-- that revision with replay true and registers nothing, so the server
-- discards its object.
-- Refusals: invalid_input, not_authorized, offer_not_found,
-- offer_not_editable (no longer „Entwurf“), offer_changed (another save came
-- first), offer_empty (no Position), offer_expired (valid before the send
-- day), and those of file_document.
create function public.send_offer(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_version integer,
  p_expected_content_version integer,
  p_attempt_key uuid,
  p_channel text,
  p_sent_on date,
  p_recipient_name text,
  p_recipient_address text,
  p_snapshot jsonb,
  p_document_id uuid default null,
  p_storage_path text default null,
  p_file_name text default null,
  p_size_bytes bigint default null,
  p_content_hash text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_offer public.offers;
  v_earlier public.offer_events;
  v_revision integer;
  v_content jsonb;
  v_name text;
  v_counter integer := 1;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_version is null or p_expected_content_version is null or p_sent_on is null
    or p_channel is null or p_channel not in ('download', 'email', 'post', 'persoenlich')
    or btrim(coalesce(p_recipient_name, '')) = '' or jsonb_typeof(p_snapshot) is distinct from 'object'
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_offer from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;

  -- Under the row lock an earlier send of this offer has committed its event.
  select * into v_earlier from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key;
  if found and (v_earlier.event_type <> 'sent' or v_earlier.offer_id <> p_offer_id) then
    raise exception 'invalid_input';
  end if;
  if not found then
    -- The same draft sent from another tab or under a lost key.
    select * into v_earlier from public.offer_events event
    where event.organization_id = p_organization_id and event.offer_id = p_offer_id
      and event.event_type = 'sent'
      and (event.payload ->> 'fromVersion')::integer = p_expected_version
      and (event.payload ->> 'fromContentVersion')::integer = p_expected_content_version;
  end if;
  if found then
    return jsonb_build_object('revision', (v_earlier.payload ->> 'revision')::integer,
      'documentId', v_earlier.payload ->> 'documentId', 'replay', true);
  end if;

  if v_offer.status <> 'entwurf' then raise exception 'offer_not_editable'; end if;
  if v_offer.version <> p_expected_version or v_offer.content_version <> p_expected_content_version then
    raise exception 'offer_changed';
  end if;
  if p_document_id is null or p_storage_path is null or p_file_name is null or p_size_bytes is null
    or p_size_bytes <= 0 or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_storage_path not like p_organization_id::text || '/' || p_document_id::text || '/%'
    -- The PDF is dated the day the server rendered it; a send across midnight keeps that day.
    or p_sent_on not between (clock_timestamp() at time zone 'Europe/Berlin')::date - 1
      and (clock_timestamp() at time zone 'Europe/Berlin')::date
  then
    raise exception 'invalid_input';
  end if;
  if v_offer.valid_until < p_sent_on then raise exception 'offer_expired'; end if;
  if not exists (
    select 1 from public.offer_positions line
    where line.organization_id = p_organization_id and line.offer_id = p_offer_id
  ) then
    raise exception 'offer_empty';
  end if;

  -- The content as stored, with each priced Position's printed number (a text line has none).
  select coalesce(jsonb_agg(jsonb_build_object(
      'number', section.position::text,
      'title', section.title,
      'netCents', section.net_cents,
      'positions', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'number', case when numbered.kind <> 'text' then section.position || '.' || numbered.counted end,
          'kind', numbered.kind, 'name', numbered.name, 'description', numbered.description,
          'quantity', numbered.quantity::text, 'unit', numbered.unit, 'unitLabel', numbered.unit_label,
          'unitPriceCents', numbered.unit_price_cents, 'priceQuantity', numbered.price_quantity,
          'taxRateBasisPoints', numbered.tax_rate_basis_points, 'amountCents', numbered.amount_cents,
          'itemId', numbered.item_id, 'purchaseCostCents', numbered.purchase_cost_cents,
          'purchasePriceQuantity', numbered.purchase_price_quantity
        )) order by numbered.position)
        from (
          select line.*, count(*) filter (where line.kind <> 'text')
            over (order by line.position) as counted
          from public.offer_positions line
          where line.organization_id = p_organization_id and line.section_id = section.id
        ) numbered
      ), '[]'::jsonb)
    ) order by section.position), '[]'::jsonb)
  into v_content
  from public.offer_sections section
  where section.organization_id = p_organization_id and section.offer_id = p_offer_id;

  select coalesce(max(revision.revision), 0) + 1 into v_revision from public.offer_revisions revision
  where revision.organization_id = p_organization_id and revision.offer_id = p_offer_id;

  -- The PDF lands in the library root, where an active name is unique: the
  -- first free `name (n).pdf`, as a Servicebericht is named
  -- (20261219113104), also when another upload takes the name meanwhile.
  v_name := btrim(p_file_name);
  loop
    if not exists (
      select 1 from public.documents document
      where document.organization_id = p_organization_id and document.folder_id is null
        and document.deleted_at is null and lower(btrim(document.display_name)) = lower(v_name)
    ) then
      begin
        insert into public.documents (
          id, organization_id, folder_id, storage_bucket, storage_path, original_file_name, display_name,
          category, mime_type, size_bytes, uploaded_by, document_date, retention_class, metadata
        ) values (
          p_document_id, p_organization_id, null, 'organization-documents', p_storage_path, v_name,
          v_name, 'offer', 'application/pdf', p_size_bytes, p_actor_id, p_sent_on, 'ten_years',
          jsonb_build_object('offerId', p_offer_id, 'revision', v_revision, 'contentHash', p_content_hash)
        );
        exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'documents_unique_active_folder_name_idx' then raise; end if;
      end;
    end if;
    v_counter := v_counter + 1;
    v_name := regexp_replace(btrim(p_file_name), '\.pdf$', '', 'i') || ' (' || v_counter || ').pdf';
  end loop;
  insert into public.document_links (organization_id, document_id, offer_id, created_by)
  values (p_organization_id, p_document_id, p_offer_id, p_actor_id);
  insert into public.document_links (organization_id, document_id, client_id, created_by)
  values (p_organization_id, p_document_id, v_offer.client_id, p_actor_id);
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_actor_id, 'uploaded',
    jsonb_build_object('source', 'offer_send', 'offerId', p_offer_id, 'revision', v_revision,
      'storagePath', p_storage_path, 'contentHash', p_content_hash, 'clientId', v_offer.client_id)
  );
  perform public.file_document(p_actor_id, p_organization_id, p_document_id);

  insert into public.offer_revisions (
    organization_id, offer_id, revision, offer_number, title, valid_until, sent_on, channel,
    client_id, recipient_client_id, recipient_name, recipient_address, snapshot, content,
    net_cents, tax_cents, gross_cents, document_id, sent_by
  ) values (
    p_organization_id, p_offer_id, v_revision, v_offer.offer_number, v_offer.title, v_offer.valid_until,
    p_sent_on, p_channel, v_offer.client_id, v_offer.recipient_client_id, btrim(p_recipient_name),
    nullif(btrim(coalesce(p_recipient_address, '')), ''), p_snapshot, v_content,
    v_offer.net_cents, v_offer.tax_cents, v_offer.gross_cents, p_document_id, p_actor_id
  );
  update public.offers offer set
    status = 'gesendet',
    version = offer.version + 1,
    updated_by = p_actor_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, 'sent', 'gesendet', v_offer.version + 1,
    jsonb_build_object('revision', v_revision, 'channel', p_channel, 'documentId', p_document_id,
      'fromVersion', v_offer.version, 'fromContentVersion', v_offer.content_version,
      'grossCents', v_offer.gross_cents),
    p_actor_id, p_attempt_key
  );
  return jsonb_build_object('revision', v_revision, 'documentId', p_document_id, 'replay', false);
end;
$$;
revoke all on function public.send_offer(uuid, uuid, uuid, integer, integer, uuid, text, date, text, text, jsonb,
  uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.send_offer(uuid, uuid, uuid, integer, integer, uuid, text, date, text, text, jsonb,
  uuid, text, text, bigint, text) to service_role;

-- 4. The sent revisions of one offer of the organization, newest first, with
-- who recorded each; an empty array for an offer without one.
create function public.list_offer_revisions(p_organization_id uuid, p_offer_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'revision', revision.revision,
    'sentOn', revision.sent_on,
    'channel', revision.channel,
    'validUntil', revision.valid_until,
    'grossCents', revision.gross_cents,
    'recipientName', revision.recipient_name,
    'documentId', revision.document_id,
    'sentBy', (select jsonb_build_object('firstName', profile.first_name, 'lastName', profile.last_name,
        'email', profile.email)
      from public.profiles profile where profile.id = revision.sent_by)
  ) order by revision.revision desc), '[]'::jsonb)
  from public.offer_revisions revision
  where revision.organization_id = p_organization_id and revision.offer_id = p_offer_id;
$$;
revoke all on function public.list_offer_revisions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_offer_revisions(uuid, uuid) to service_role;
