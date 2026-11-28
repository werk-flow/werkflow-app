-- The office records who accepted which revision of an offer, when and how,
-- and the accepted scope is frozen; or it records a rejection or withdraws
-- the offer (werk-flow/werkflow-planning#385, E2a K9).
--
-- 1. offer_acceptances: one row per recorded Annahme of a sent revision,
--    frozen. It keeps the accepting person's name exactly as the office typed
--    it, the day, the channel (unterschriebenes Angebot, E-Mail, Telefon, vor
--    Ort), a note, the chosen Bedarfs- and Alternativpositionen by their
--    printed numbers, and the Auftragsumfang: the revision's Titel and
--    Positionen with each chosen option in and each Position a chosen
--    Alternativposition replaces out, every amount as the revision froze it,
--    and the resulting totals. No cost or margin: the scope is what the
--    customer accepted. Nothing else about the person is stored or linked.
-- 2. offer_acceptance_withdrawals: a mistaken Annahme is withdrawn by a new
--    row that names it, with a reason; the Annahme stays.
-- 3. accept_offer: in one call it checks the offer is still at the version
--    the office saw and the revision is the newest sent one, builds the
--    Auftragsumfang from that revision and the chosen options, checks the
--    server's totals against it, writes the Annahme, sets „Angenommen“ and
--    writes the history. An open draft of the next revision is closed in the
--    same call with its own history entry, and the offer's title, validity
--    and texts return to what the decided revision printed: the customer
--    accepted what was sent. An Annahme after the validity date is recorded; the page derives
--    its hint from the revision's date.
-- 4. withdraw_offer_acceptance: the standing Annahme gets its withdrawal
--    row, the offer is „Gesendet“ again, and the history names both.
-- 5. close_offer: „Abgelehnt“ (the customer declined) or „Zurückgezogen“
--    (the office withdrew its offer), with a reason in the history; an open
--    draft closes as in 3.
-- 6. get_offer_decisions: the server's read of an offer's Annahmen and
--    closing, which get_offer_with_revisions now carries in its one statement.
--
-- Division of work: lib/offers/acceptance.ts establishes identity, the
-- manager role and the organization, reads the revision and computes the
-- Auftragsumfang's totals by the offer's line and VAT rule
-- (lib/offers/accepted-scope.ts); the functions check the actor again under
-- the access lock. No SQL repeats the rounding rule: the scope's amounts are
-- the revision's, and the function only adds them up to check the server.
--
-- Expand-only: two new tables, four new functions, one replaced read that
-- adds a key an older build ignores.
--
-- Prevention: Tier 1 (the ledger guard, the checks under the row lock, no
-- client grant), Tier 2 supabase/tests/offer_acceptance.sql.

-- 1. The recorded Annahmen.
create table public.offer_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offer_id uuid not null,
  revision integer not null,
  -- The accepting person exactly as the office typed the name; no contact is linked.
  accepted_by_name text not null,
  accepted_on date not null,
  -- unterschrift, email, telefon or vor_ort.
  channel text not null,
  note text not null default '',
  -- The printed numbers of the chosen Bedarfs- and Alternativpositionen.
  chosen_options text[] not null default '{}',
  -- The Auftragsumfang: Titel in order with their kept Positionen and subtotals.
  scope jsonb not null,
  net_cents bigint not null,
  tax_cents bigint not null,
  gross_cents bigint not null,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint offer_acceptances_offer_fk foreign key (offer_id, organization_id)
    references public.offers (id, organization_id) on delete cascade,
  constraint offer_acceptances_revision_fk foreign key (offer_id, revision)
    references public.offer_revisions (offer_id, revision) on delete cascade,
  constraint offer_acceptances_id_organization_unique unique (id, organization_id),
  constraint offer_acceptances_channel_check check (channel in ('unterschrift', 'email', 'telefon', 'vor_ort')),
  constraint offer_acceptances_name_check check (
    btrim(accepted_by_name) <> '' and char_length(accepted_by_name) <= 200
  ),
  constraint offer_acceptances_note_check check (char_length(note) <= 2000),
  constraint offer_acceptances_totals_check check (gross_cents = net_cents + tax_cents),
  constraint offer_acceptances_scope_check check (jsonb_typeof(scope) = 'array')
);

create index offer_acceptances_offer_idx on public.offer_acceptances (offer_id, organization_id, created_at desc);
create index offer_acceptances_organization_id_fk_idx on public.offer_acceptances (organization_id);
create index offer_acceptances_revision_idx on public.offer_acceptances (offer_id, revision);
create index offer_acceptances_recorded_by_idx on public.offer_acceptances (recorded_by);

-- 2. The withdrawals of mistaken Annahmen, one at most per Annahme.
create table public.offer_acceptance_withdrawals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  acceptance_id uuid not null,
  reason text not null,
  withdrawn_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint offer_acceptance_withdrawals_acceptance_fk foreign key (acceptance_id, organization_id)
    references public.offer_acceptances (id, organization_id) on delete cascade,
  -- One withdrawal per Annahme; the key also serves the foreign key's lookup.
  constraint offer_acceptance_withdrawals_acceptance_unique unique (acceptance_id, organization_id),
  constraint offer_acceptance_withdrawals_reason_check check (
    btrim(reason) <> '' and char_length(reason) <= 2000
  )
);

create index offer_acceptance_withdrawals_organization_id_fk_idx
  on public.offer_acceptance_withdrawals (organization_id);
create index offer_acceptance_withdrawals_withdrawn_by_idx on public.offer_acceptance_withdrawals (withdrawn_by);

-- The server reads and writes both, as it does the revisions; no signed-in role reads a row.
alter table public.offer_acceptances enable row level security;
revoke all on table public.offer_acceptances from public, anon, authenticated, service_role;
grant select, insert on table public.offer_acceptances to service_role;
alter table public.offer_acceptance_withdrawals enable row level security;
revoke all on table public.offer_acceptance_withdrawals from public, anon, authenticated, service_role;
grant select, insert on table public.offer_acceptance_withdrawals to service_role;

-- No update, no delete: only a foreign key's set null or cascade passes.
create trigger guard_event_ledger_history before update or delete on public.offer_acceptances
  for each row execute function app_private.guard_event_ledger_history();
create trigger guard_event_ledger_history before update or delete on public.offer_acceptance_withdrawals
  for each row execute function app_private.guard_event_ledger_history();

-- The open draft of revision p_sent + 1 of the locked offer p_offer closes
-- because the customer decided on revision p_sent (p_cause: accepted,
-- rejected or withdrawn). The title, validity and texts return to what that
-- revision printed, so the page, the list and „Abgelaufen“ read the decided
-- revision. Its history entry says whether the draft held changes since its
-- start, to its header or its Positionen: the Positionen then keep the
-- unsent ones, since a revision holds no cost to restore. Its callers check
-- the actor, lock the offer and bump its version after it.
create function app_private.close_offer_draft(
  p_offer public.offers,
  p_actor_id uuid,
  p_sent integer,
  p_status text,
  p_cause text
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_started public.offer_events;
  v_revision public.offer_revisions;
begin
  select * into v_started from public.offer_events event
  where event.organization_id = p_offer.organization_id and event.offer_id = p_offer.id
    and event.event_type = 'revision_started'
  order by event.version desc
  limit 1;
  select * into v_revision from public.offer_revisions revision
  where revision.organization_id = p_offer.organization_id and revision.offer_id = p_offer.id
    and revision.revision = p_sent;
  update public.offers offer set
    title = v_revision.title,
    valid_until = v_revision.valid_until,
    opening_text = coalesce(v_revision.snapshot ->> 'openingText', offer.opening_text),
    closing_text = coalesce(v_revision.snapshot ->> 'closingText', offer.closing_text)
  where offer.organization_id = p_offer.organization_id and offer.id = p_offer.id;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_offer.organization_id, p_offer.id, 'draft_closed', p_status, p_offer.version + 1,
    jsonb_build_object('revision', p_sent + 1, 'decidedRevision', p_sent, 'cause', p_cause,
      'draftChanged', p_offer.version is distinct from v_started.version
        or p_offer.content_version is distinct from (v_started.payload ->> 'contentVersion')::integer),
    p_actor_id, gen_random_uuid()
  );
end;
$$;
revoke all on function app_private.close_offer_draft(public.offers, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function app_private.close_offer_draft(public.offers, uuid, integer, text, text) to service_role;

-- 3. Records the Annahme of revision p_revision of the offer p_offer_id, which
-- is still at p_expected_version. p_accepted_on is the day the customer
-- accepted, between the send day and today in Berlin. p_chosen_options names
-- the chosen Bedarfs- and Alternativpositionen by their printed numbers, at
-- most one Alternativposition per replaced Position. p_totals is
-- {netCents, taxCents, grossCents} of the Auftragsumfang as the server
-- computed it. The answer is {acceptanceId, version, updatedAt, replay}: a
-- call under the attempt key of an earlier Annahme answers it with replay
-- true and writes nothing.
-- Refusals: invalid_input, not_authorized, offer_not_found, offer_not_sent
-- (never sent), offer_decided (accepted, rejected or withdrawn),
-- offer_changed (another change came first), revision_superseded (not the
-- newest sent revision), scope_mismatch (the server's totals are not the
-- scope's).
create function public.accept_offer(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_version integer,
  p_attempt_key uuid,
  p_revision integer,
  p_accepted_by_name text,
  p_accepted_on date,
  p_channel text,
  p_note text,
  p_chosen_options text[],
  p_totals jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_offer public.offers;
  v_earlier public.offer_events;
  v_revision public.offer_revisions;
  v_sent integer;
  v_replaced text[];
  v_scope jsonb;
  v_net bigint;
  v_acceptance_id uuid;
  v_updated_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_version is null or p_revision is null or p_accepted_on is null
    or p_channel is null or p_channel not in ('unterschrift', 'email', 'telefon', 'vor_ort')
    or btrim(coalesce(p_accepted_by_name, '')) = '' or char_length(p_accepted_by_name) > 200
    or p_note is null or char_length(p_note) > 2000 or p_chosen_options is null
    or array_position(p_chosen_options, null) is not null
    or jsonb_typeof(p_totals -> 'netCents') is distinct from 'number'
    or jsonb_typeof(p_totals -> 'taxCents') is distinct from 'number'
    or jsonb_typeof(p_totals -> 'grossCents') is distinct from 'number'
    or p_accepted_on > (clock_timestamp() at time zone 'Europe/Berlin')::date
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_offer from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;

  -- Under the row lock an earlier Annahme under this key has committed its event.
  select * into v_earlier from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key;
  if found then
    if v_earlier.event_type <> 'accepted' or v_earlier.offer_id <> p_offer_id then
      raise exception 'invalid_input';
    end if;
    return jsonb_build_object('acceptanceId', v_earlier.payload ->> 'acceptanceId',
      'version', v_earlier.version, 'updatedAt', v_offer.updated_at, 'replay', true);
  end if;

  select max(revision.revision) into v_sent from public.offer_revisions revision
  where revision.organization_id = p_organization_id and revision.offer_id = p_offer_id;
  if v_sent is null then raise exception 'offer_not_sent'; end if;
  if v_offer.status not in ('gesendet', 'entwurf') then raise exception 'offer_decided'; end if;
  if v_offer.version <> p_expected_version then raise exception 'offer_changed'; end if;
  if p_revision <> v_sent then
    if p_revision between 1 and v_sent then raise exception 'revision_superseded'; end if;
    raise exception 'invalid_input';
  end if;
  select * into v_revision from public.offer_revisions revision
  where revision.organization_id = p_organization_id and revision.offer_id = p_offer_id
    and revision.revision = p_revision;
  if p_accepted_on < v_revision.sent_on then raise exception 'invalid_input'; end if;

  -- Each chosen number is a Bedarfs- or Alternativposition of the revision, named once, and
  -- no two chosen Alternativpositionen replace the same Position.
  if (
    select count(*) from jsonb_array_elements(v_revision.content) section,
      jsonb_array_elements(section -> 'positions') line
    where line ->> 'number' = any (p_chosen_options) and line ->> 'positionType' in ('bedarf', 'alternative')
  ) <> cardinality(p_chosen_options)
    or (select count(distinct option) from unnest(p_chosen_options) option) <> cardinality(p_chosen_options)
  then
    raise exception 'invalid_input';
  end if;
  select coalesce(array_agg(line ->> 'alternativeTo'), '{}') into v_replaced
  from jsonb_array_elements(v_revision.content) section, jsonb_array_elements(section -> 'positions') line
  where line ->> 'number' = any (p_chosen_options) and line ->> 'positionType' = 'alternative';
  if (select count(distinct replaced) from unnest(v_replaced) replaced) <> cardinality(v_replaced) then
    raise exception 'invalid_input';
  end if;

  -- The Auftragsumfang: every text line and normal Position but the replaced ones, and the
  -- chosen options marked as such, each as the revision froze it; a Titel's subtotal adds
  -- its kept amounts.
  select coalesce(jsonb_agg(jsonb_build_object(
      'number', section.value -> 'number', 'title', section.value -> 'title',
      'netCents', kept.net_cents, 'positions', kept.positions) order by section.ordinality), '[]'::jsonb),
    coalesce(sum(kept.net_cents), 0)
  into v_scope, v_net
  from jsonb_array_elements(v_revision.content) with ordinality section(value, ordinality)
  cross join lateral (
    select coalesce(jsonb_agg(
        (line.value - 'positionType' - 'alternativeTo') || case
          when line.value ->> 'positionType' = 'bedarf' then '{"option": "bedarf"}'::jsonb
          when line.value ->> 'positionType' = 'alternative' then
            jsonb_build_object('option', 'alternative', 'replaces', line.value -> 'alternativeTo')
          else '{}'::jsonb end
        order by line.ordinality), '[]'::jsonb) as positions,
      coalesce(sum((line.value ->> 'amountCents')::bigint), 0) as net_cents
    from jsonb_array_elements(section.value -> 'positions') with ordinality line(value, ordinality)
    where (line.value ->> 'positionType' is null
        and coalesce(line.value ->> 'number', '') <> all (v_replaced))
      or line.value ->> 'number' = any (p_chosen_options)
  ) kept;
  if (p_totals ->> 'netCents')::bigint <> v_net
    or (p_totals ->> 'grossCents')::bigint <> v_net + (p_totals ->> 'taxCents')::bigint
  then
    raise exception 'scope_mismatch';
  end if;

  if v_offer.status = 'entwurf' then
    perform app_private.close_offer_draft(v_offer, p_actor_id, v_sent, 'angenommen', 'accepted');
  end if;
  insert into public.offer_acceptances (
    organization_id, offer_id, revision, accepted_by_name, accepted_on, channel, note, chosen_options,
    scope, net_cents, tax_cents, gross_cents, recorded_by
  ) values (
    p_organization_id, p_offer_id, p_revision, p_accepted_by_name, p_accepted_on, p_channel,
    btrim(p_note), p_chosen_options, v_scope, v_net, (p_totals ->> 'taxCents')::bigint,
    (p_totals ->> 'grossCents')::bigint, p_actor_id
  )
  returning id into v_acceptance_id;
  update public.offers offer set
    status = 'angenommen',
    version = offer.version + 1,
    updated_by = p_actor_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  returning offer.updated_at into v_updated_at;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, 'accepted', 'angenommen', v_offer.version + 1,
    jsonb_build_object('revision', p_revision, 'acceptanceId', v_acceptance_id, 'channel', p_channel,
      'acceptedOn', p_accepted_on, 'chosenOptions', to_jsonb(p_chosen_options),
      'grossCents', (p_totals ->> 'grossCents')::bigint, 'fromVersion', v_offer.version),
    p_actor_id, p_attempt_key
  );
  return jsonb_build_object('acceptanceId', v_acceptance_id, 'version', v_offer.version + 1,
    'updatedAt', v_updated_at, 'replay', false);
end;
$$;
revoke all on function public.accept_offer(uuid, uuid, uuid, integer, uuid, integer, text, date, text, text,
  text[], jsonb) from public, anon, authenticated;
grant execute on function public.accept_offer(uuid, uuid, uuid, integer, uuid, integer, text, date, text, text,
  text[], jsonb) to service_role;

-- 4. Withdraws the standing Annahme of the accepted offer p_offer_id, still at
-- p_expected_version, with p_reason: a withdrawal row names it, the offer is
-- „Gesendet“ again and its history names the Annahme. The Annahme stays.
-- A later conversion into work refuses this once work exists. The answer is
-- {version, updatedAt, replay}.
-- Refusals: invalid_input, not_authorized, offer_not_found, offer_not_accepted,
-- offer_changed.
create function public.withdraw_offer_acceptance(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_version integer,
  p_attempt_key uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_offer public.offers;
  v_earlier public.offer_events;
  v_acceptance public.offer_acceptances;
  v_updated_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_version is null or btrim(coalesce(p_reason, '')) = '' or char_length(p_reason) > 2000
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_offer from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;

  select * into v_earlier from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key;
  if found then
    if v_earlier.event_type <> 'acceptance_withdrawn' or v_earlier.offer_id <> p_offer_id then
      raise exception 'invalid_input';
    end if;
    return jsonb_build_object('version', v_earlier.version, 'updatedAt', v_offer.updated_at, 'replay', true);
  end if;

  if v_offer.status <> 'angenommen' then raise exception 'offer_not_accepted'; end if;
  if v_offer.version <> p_expected_version then raise exception 'offer_changed'; end if;
  select acceptance.* into v_acceptance from public.offer_acceptances acceptance
  where acceptance.organization_id = p_organization_id and acceptance.offer_id = p_offer_id
    and not exists (
      select 1 from public.offer_acceptance_withdrawals withdrawal
      where withdrawal.organization_id = p_organization_id and withdrawal.acceptance_id = acceptance.id
    );
  if not found then raise exception 'offer_not_accepted'; end if;

  insert into public.offer_acceptance_withdrawals (organization_id, acceptance_id, reason, withdrawn_by)
  values (p_organization_id, v_acceptance.id, btrim(p_reason), p_actor_id);
  update public.offers offer set
    status = 'gesendet',
    version = offer.version + 1,
    updated_by = p_actor_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  returning offer.updated_at into v_updated_at;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, 'acceptance_withdrawn', 'gesendet', v_offer.version + 1,
    jsonb_build_object('revision', v_acceptance.revision, 'acceptanceId', v_acceptance.id,
      'fromVersion', v_offer.version),
    p_actor_id, p_attempt_key
  );
  return jsonb_build_object('version', v_offer.version + 1, 'updatedAt', v_updated_at, 'replay', false);
end;
$$;
revoke all on function public.withdraw_offer_acceptance(uuid, uuid, uuid, integer, uuid, text)
  from public, anon, authenticated;
grant execute on function public.withdraw_offer_acceptance(uuid, uuid, uuid, integer, uuid, text) to service_role;

-- 5. Closes the sent offer p_offer_id, still at p_expected_version, as
-- p_outcome „abgelehnt“ (the customer declined its newest sent revision) or
-- „zurueckgezogen“ (the office withdrew it), with p_reason in its history.
-- An open draft of the next revision closes in the same call. The answer is
-- {version, updatedAt, replay}.
-- Refusals: invalid_input, not_authorized, offer_not_found, offer_not_sent,
-- offer_decided, offer_changed.
create function public.close_offer(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_version integer,
  p_attempt_key uuid,
  p_outcome text,
  p_reason text
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
  v_event_type text;
  v_updated_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_version is null or p_outcome is null or p_outcome not in ('abgelehnt', 'zurueckgezogen')
    or btrim(coalesce(p_reason, '')) = '' or char_length(p_reason) > 2000
  then
    raise exception 'invalid_input';
  end if;
  v_event_type := case p_outcome when 'abgelehnt' then 'rejected' else 'withdrawn' end;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_offer from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;

  select * into v_earlier from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key;
  if found then
    if v_earlier.event_type <> v_event_type or v_earlier.offer_id <> p_offer_id then
      raise exception 'invalid_input';
    end if;
    return jsonb_build_object('version', v_earlier.version, 'updatedAt', v_offer.updated_at, 'replay', true);
  end if;

  select max(revision.revision) into v_sent from public.offer_revisions revision
  where revision.organization_id = p_organization_id and revision.offer_id = p_offer_id;
  if v_sent is null then raise exception 'offer_not_sent'; end if;
  if v_offer.status not in ('gesendet', 'entwurf') then raise exception 'offer_decided'; end if;
  if v_offer.version <> p_expected_version then raise exception 'offer_changed'; end if;

  if v_offer.status = 'entwurf' then
    perform app_private.close_offer_draft(v_offer, p_actor_id, v_sent, p_outcome, v_event_type);
  end if;
  update public.offers offer set
    status = p_outcome,
    version = offer.version + 1,
    updated_by = p_actor_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  returning offer.updated_at into v_updated_at;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, v_event_type, p_outcome, v_offer.version + 1,
    jsonb_build_object('revision', v_sent, 'reason', btrim(p_reason), 'fromVersion', v_offer.version),
    p_actor_id, p_attempt_key
  );
  return jsonb_build_object('version', v_offer.version + 1, 'updatedAt', v_updated_at, 'replay', false);
end;
$$;
revoke all on function public.close_offer(uuid, uuid, uuid, integer, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.close_offer(uuid, uuid, uuid, integer, uuid, text, text) to service_role;

-- 6. An offer's decisions: its Annahmen, the standing one first, then the
-- withdrawn ones newest first, each with its
-- revision's validity, who recorded it and its withdrawal, and the closing
-- („Abgelehnt“ or „Zurückgezogen“) while the offer is closed; null for none.
create function public.get_offer_decisions(p_organization_id uuid, p_offer_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'acceptances', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', acceptance.id,
        'revision', acceptance.revision,
        'acceptedByName', acceptance.accepted_by_name,
        'acceptedOn', acceptance.accepted_on,
        'channel', acceptance.channel,
        'note', acceptance.note,
        'chosenOptions', to_jsonb(acceptance.chosen_options),
        'scope', acceptance.scope,
        'netCents', acceptance.net_cents,
        'taxCents', acceptance.tax_cents,
        'grossCents', acceptance.gross_cents,
        'validUntil', revision.valid_until,
        'recordedAt', acceptance.created_at,
        'recordedBy', (select jsonb_build_object('firstName', profile.first_name,
            'lastName', profile.last_name, 'email', profile.email)
          from public.profiles profile where profile.id = acceptance.recorded_by),
        'withdrawal', (select jsonb_build_object('reason', withdrawal.reason, 'withdrawnAt', withdrawal.created_at,
            'withdrawnBy', (select jsonb_build_object('firstName', profile.first_name,
                'lastName', profile.last_name, 'email', profile.email)
              from public.profiles profile where profile.id = withdrawal.withdrawn_by))
          from public.offer_acceptance_withdrawals withdrawal
          where withdrawal.organization_id = p_organization_id and withdrawal.acceptance_id = acceptance.id)
      ) order by exists (
          select 1 from public.offer_acceptance_withdrawals withdrawal
          where withdrawal.organization_id = p_organization_id and withdrawal.acceptance_id = acceptance.id
        ), acceptance.created_at desc), '[]'::jsonb)
      from public.offer_acceptances acceptance
      join public.offer_revisions revision
        on revision.organization_id = p_organization_id and revision.offer_id = acceptance.offer_id
        and revision.revision = acceptance.revision
      where acceptance.organization_id = p_organization_id and acceptance.offer_id = p_offer_id
    ),
    'closing', (
      select jsonb_build_object('outcome', event.status, 'revision', (event.payload ->> 'revision')::integer,
        'reason', event.payload ->> 'reason', 'recordedAt', event.created_at,
        'recordedBy', (select jsonb_build_object('firstName', profile.first_name,
            'lastName', profile.last_name, 'email', profile.email)
          from public.profiles profile where profile.id = event.actor_id))
      from public.offer_events event
      join public.offers offer on offer.id = event.offer_id and offer.organization_id = p_organization_id
      where event.organization_id = p_organization_id and event.offer_id = p_offer_id
        and event.event_type in ('rejected', 'withdrawn') and event.status = offer.status
      order by event.version desc
      limit 1
    ));
$$;
revoke all on function public.get_offer_decisions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_offer_decisions(uuid, uuid) to service_role;

-- As in 20270701090000, and the offer's decisions from the same snapshot.
create or replace function public.get_offer_with_revisions(p_organization_id uuid, p_offer_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'offer', public.get_offer_with_costs(p_organization_id, p_offer_id),
    'revisions', public.list_offer_revisions(p_organization_id, p_offer_id),
    'decisions', public.get_offer_decisions(p_organization_id, p_offer_id));
$$;
revoke all on function public.get_offer_with_revisions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_offer_with_revisions(uuid, uuid) to service_role;
