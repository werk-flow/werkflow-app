-- The company document profile (werk-flow/werkflow-planning#378): one row per
-- organization with the details every generated business document carries,
-- its logo, its stationery and the defaults of a new offer. Admin and Büro
-- edit it under „Einstellungen → Dokumente & Briefpapier“.
--
-- 1. company_document_profiles is server-only: no client role reads or writes
--    a column, so bank details and names never reach the Data API, and an
--    employee reads nothing. The server reads it with the service role after
--    the manager check (lib/company-profile/).
-- 2. company_document_profile_events is its append-only history: one row per
--    changed field with actor, old and new value, written in the call that
--    changes the field.
-- 3. save_company_document_profile and replace_company_document_file are the
--    two writes. A replaced or removed file queues its object for the purge in
--    the same call: a stored document carries its own bytes, so no row needs
--    the old object once the backup window has passed.
-- 4. Each write carries the caller's attempt key in its history rows. A retry
--    under that key, whose first answer was lost, gets the first result and
--    writes nothing, before the version or file check
--    (docs/technical/data-model.md).
-- 5. The organization export plans the profile's files with the documents'
--    originals: each file records its size as stored, and the plan row of a
--    file without a document names none.
--
-- Prevention: Tier 1 (no client grant, the history guard, the checks below),
-- Tier 2 supabase/tests/company_document_profiles.sql.

create table public.company_document_profiles (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  company_name text not null default '',
  street text not null default '',
  postal_code text not null default '',
  city text not null default '',
  phone text not null default '',
  email text not null default '',
  website text not null default '',
  register_court text not null default '',
  register_number text not null default '',
  managing_directors text not null default '',
  tax_number text not null default '',
  vat_id text not null default '',
  bank_name text not null default '',
  iban text not null default '',
  bic text not null default '',
  offer_opening_text text not null default '',
  offer_closing_text text not null default '',
  offer_validity_days integer not null default 30,
  standard_tax_rate_basis_points integer not null default 1900,
  -- Distances from the paper's edges in millimetres that the content keeps
  -- clear on a page with stationery; they apply only while that page has one.
  stationery_first_top_mm integer not null default 45,
  stationery_first_right_mm integer not null default 20,
  stationery_first_bottom_mm integer not null default 25,
  stationery_first_left_mm integer not null default 25,
  stationery_following_top_mm integer not null default 30,
  stationery_following_right_mm integer not null default 20,
  stationery_following_bottom_mm integer not null default 25,
  stationery_following_left_mm integer not null default 25,
  -- Each file's size in bytes as stored, for the organization export's plan.
  logo_storage_path text,
  logo_mime_type text,
  logo_size_bytes bigint,
  stationery_first_storage_path text,
  stationery_first_mime_type text,
  stationery_first_size_bytes bigint,
  stationery_following_storage_path text,
  stationery_following_mime_type text,
  stationery_following_size_bytes bigint,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  -- Null once the person's account is deleted: the profile stays.
  updated_by uuid references auth.users (id) on delete set null,
  constraint company_document_profiles_short_text_check check (
    char_length(company_name) <= 200 and char_length(street) <= 200
    and char_length(postal_code) <= 20 and char_length(city) <= 200
    and char_length(phone) <= 100 and char_length(email) <= 200 and char_length(website) <= 200
    and char_length(register_court) <= 200 and char_length(register_number) <= 100
    and char_length(managing_directors) <= 500 and char_length(tax_number) <= 100
    and char_length(vat_id) <= 100 and char_length(bank_name) <= 200
    and char_length(iban) <= 100 and char_length(bic) <= 20
  ),
  constraint company_document_profiles_long_text_check check (
    char_length(offer_opening_text) <= 4000 and char_length(offer_closing_text) <= 4000
  ),
  constraint company_document_profiles_offer_defaults_check check (
    offer_validity_days between 1 and 365
    and standard_tax_rate_basis_points between 0 and 10000
  ),
  constraint company_document_profiles_margins_check check (
    stationery_first_top_mm between 0 and 150 and stationery_first_right_mm between 0 and 80
    and stationery_first_bottom_mm between 0 and 150 and stationery_first_left_mm between 0 and 80
    and stationery_following_top_mm between 0 and 150 and stationery_following_right_mm between 0 and 80
    and stationery_following_bottom_mm between 0 and 150 and stationery_following_left_mm between 0 and 80
  ),
  -- A file lies under the organization's own Briefpapier folder, and its type
  -- is one the renderer embeds: a logo is an image, stationery an image or a PDF.
  constraint company_document_profiles_logo_check check (
    (logo_storage_path is null) = (logo_mime_type is null)
    and (logo_storage_path is null) = (logo_size_bytes is null)
    and (logo_storage_path is null
      or (starts_with(logo_storage_path, organization_id::text || '/briefpapier/')
        and logo_mime_type in ('image/png', 'image/jpeg')
        and logo_size_bytes >= 0))
  ),
  constraint company_document_profiles_stationery_first_check check (
    (stationery_first_storage_path is null) = (stationery_first_mime_type is null)
    and (stationery_first_storage_path is null) = (stationery_first_size_bytes is null)
    and (stationery_first_storage_path is null
      or (starts_with(stationery_first_storage_path, organization_id::text || '/briefpapier/')
        and stationery_first_mime_type in ('application/pdf', 'image/png', 'image/jpeg')
        and stationery_first_size_bytes >= 0))
  ),
  constraint company_document_profiles_stationery_following_check check (
    (stationery_following_storage_path is null) = (stationery_following_mime_type is null)
    and (stationery_following_storage_path is null) = (stationery_following_size_bytes is null)
    and (stationery_following_storage_path is null
      or (starts_with(stationery_following_storage_path, organization_id::text || '/briefpapier/')
        and stationery_following_mime_type in ('application/pdf', 'image/png', 'image/jpeg')
        and stationery_following_size_bytes >= 0))
  ),
  -- Following pages take stationery only after the first page has one.
  constraint company_document_profiles_stationery_order_check check (
    stationery_following_storage_path is null or stationery_first_storage_path is not null
  )
);

create index company_document_profiles_updated_by_fk_idx on public.company_document_profiles (updated_by);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.company_document_profiles enable row level security;
revoke all on table public.company_document_profiles from public, anon, authenticated, service_role;
grant select, insert, update on table public.company_document_profiles to service_role;

create table public.company_document_profile_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- A profile column, or for a file `logo`, `stationery_first`, `stationery_following`.
  field text not null,
  old_value text,
  new_value text,
  -- Null once the actor's account is deleted: the change stays, the person does not.
  actor_id uuid references auth.users (id) on delete set null,
  -- The write that made the change: a retry under the same key answers from these rows.
  attempt_key uuid not null,
  -- The details' version a save produced; null for a file change.
  profile_version integer,
  created_at timestamptz not null default now(),
  constraint company_document_profile_events_change_check check (old_value is distinct from new_value)
);

create index company_document_profile_events_organization_created_idx
  on public.company_document_profile_events (organization_id, created_at desc, id desc);
create index company_document_profile_events_actor_id_fk_idx
  on public.company_document_profile_events (actor_id);
create index company_document_profile_events_attempt_idx
  on public.company_document_profile_events (organization_id, attempt_key);

alter table public.company_document_profile_events enable row level security;
revoke all on table public.company_document_profile_events from public, anon, authenticated, service_role;
grant select, insert on table public.company_document_profile_events to service_role;

create trigger guard_event_ledger_history before update or delete on public.company_document_profile_events
  for each row execute function app_private.guard_event_ledger_history();

-- The actor is an Admin or Büro member of the organization whose access is
-- in effect: the access lifecycle's advisory lock, taken shared, holds off a
-- suspension, and the share lock holds the membership until commit. Creates the
-- organization's empty profile when it has none and returns it locked.
create function app_private.lock_company_document_profile(p_organization_id uuid, p_actor_id uuid)
returns public.company_document_profiles
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_profile public.company_document_profiles;
begin
  -- A suspension writes only the access lifecycle, under this advisory lock
  -- (set_personnel_access_transition). Taken shared before the access check,
  -- it lets no suspension commit between the check and this call's write.
  perform pg_advisory_xact_lock_shared(hashtextextended(
    p_organization_id::text || ':p1-24-access:' || record.id::text, 0
  ))
  from public.employee_records record
  where record.organization_id = p_organization_id and record.user_id = p_actor_id;
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
    and member.role = any (array['admin'::public.org_role, 'buero'::public.org_role])
    -- A suspended or ended member keeps the row and its role, but not the access.
    and app_private.p1_24_has_effective_access(member.organization_id, member.user_id)
  for share;
  if not found then
    raise exception 'not_authorized';
  end if;

  insert into public.company_document_profiles (organization_id) values (p_organization_id)
  on conflict (organization_id) do nothing;
  select * into strict v_profile from public.company_document_profiles profile
  where profile.organization_id = p_organization_id
  for update;
  return v_profile;
end;
$$;

revoke all on function app_private.lock_company_document_profile(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.lock_company_document_profile(uuid, uuid) to service_role;

-- Saves the profile's details and offer defaults from the server's parsed
-- values: a JSON object with exactly the fields below. Refusals:
-- not_authorized, invalid_input for another key set, profile_changed when the
-- profile moved past p_expected_version, no_changes when every value equals
-- the saved one; a table check refuses a value out of range. Writes one
-- history row per changed field and returns the new version. A call under an
-- attempt key the actor's earlier save wrote under returns that save's
-- version and writes nothing, before the version check.
create function public.save_company_document_profile(
  p_actor_id uuid,
  p_organization_id uuid,
  p_expected_version integer,
  p_values jsonb,
  p_attempt_key uuid
)
returns integer
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_fields constant text[] := array[
    'company_name', 'street', 'postal_code', 'city', 'phone', 'email', 'website',
    'register_court', 'register_number', 'managing_directors', 'tax_number', 'vat_id',
    'bank_name', 'iban', 'bic', 'offer_opening_text', 'offer_closing_text',
    'offer_validity_days', 'standard_tax_rate_basis_points',
    'stationery_first_top_mm', 'stationery_first_right_mm', 'stationery_first_bottom_mm',
    'stationery_first_left_mm', 'stationery_following_top_mm', 'stationery_following_right_mm',
    'stationery_following_bottom_mm', 'stationery_following_left_mm'
  ];
  v_old public.company_document_profiles;
  v_new public.company_document_profiles;
  v_old_json jsonb;
  v_new_json jsonb;
  v_changed integer;
  v_replayed integer;
begin
  v_old := app_private.lock_company_document_profile(p_organization_id, p_actor_id);
  if p_attempt_key is null then
    raise exception 'invalid_input';
  end if;
  select max(event.profile_version) into v_replayed
  from public.company_document_profile_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key
    and event.actor_id = p_actor_id and event.profile_version is not null;
  if v_replayed is not null then
    return v_replayed;
  end if;
  if jsonb_typeof(p_values) is distinct from 'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_values) key)
      is distinct from (select array_agg(field order by field) from unnest(v_fields) field)
  then
    raise exception 'invalid_input';
  end if;
  if v_old.version is distinct from p_expected_version then
    raise exception 'profile_changed';
  end if;

  v_new := jsonb_populate_record(v_old, p_values);
  v_old_json := to_jsonb(v_old);
  v_new_json := to_jsonb(v_new);

  insert into public.company_document_profile_events (
    organization_id, field, old_value, new_value, actor_id, attempt_key, profile_version
  )
  select p_organization_id, field, v_old_json ->> field, v_new_json ->> field, p_actor_id,
    p_attempt_key, v_old.version + 1
  from unnest(v_fields) with ordinality as listed(field, position)
  where (v_old_json ->> field) is distinct from (v_new_json ->> field)
  order by position;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    raise exception 'no_changes';
  end if;

  update public.company_document_profiles profile set
    company_name = v_new.company_name, street = v_new.street, postal_code = v_new.postal_code,
    city = v_new.city, phone = v_new.phone, email = v_new.email, website = v_new.website,
    register_court = v_new.register_court, register_number = v_new.register_number,
    managing_directors = v_new.managing_directors, tax_number = v_new.tax_number,
    vat_id = v_new.vat_id, bank_name = v_new.bank_name, iban = v_new.iban, bic = v_new.bic,
    offer_opening_text = v_new.offer_opening_text, offer_closing_text = v_new.offer_closing_text,
    offer_validity_days = v_new.offer_validity_days,
    standard_tax_rate_basis_points = v_new.standard_tax_rate_basis_points,
    stationery_first_top_mm = v_new.stationery_first_top_mm,
    stationery_first_right_mm = v_new.stationery_first_right_mm,
    stationery_first_bottom_mm = v_new.stationery_first_bottom_mm,
    stationery_first_left_mm = v_new.stationery_first_left_mm,
    stationery_following_top_mm = v_new.stationery_following_top_mm,
    stationery_following_right_mm = v_new.stationery_following_right_mm,
    stationery_following_bottom_mm = v_new.stationery_following_bottom_mm,
    stationery_following_left_mm = v_new.stationery_following_left_mm,
    version = v_old.version + 1, updated_at = now(), updated_by = p_actor_id
  -- The helper locked the row and the check above compared its version; the
  -- filter states that inline.
  where profile.organization_id = p_organization_id and profile.version = p_expected_version;
  return v_old.version + 1;
end;
$$;

revoke all on function public.save_company_document_profile(uuid, uuid, integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_company_document_profile(uuid, uuid, integer, jsonb, uuid) to service_role;

-- Sets or removes (p_storage_path null) the logo or a stationery page. The
-- object was promoted by the server under the organization's Briefpapier
-- folder; p_size_bytes is its stored size. p_expected_storage_path names the
-- file the caller saw in that place, null for none: another file there means
-- someone changed it since, and the call writes and queues nothing. Removing
-- the first page's stationery removes the following pages' too, so that
-- removal also names the following pages' file the caller saw
-- (p_expected_following_storage_path, null for none; other calls ignore it).
-- A call under an attempt key the actor's earlier change of this kind wrote
-- under writes nothing, before the file check. Every changed file writes its
-- history row and queues its old object for the purge.
-- Refusals: not_authorized, invalid_input for another kind, file_changed,
-- stationery_first_missing for following pages without a first page; a table
-- check refuses a path outside the folder or another type.
create function public.replace_company_document_file(
  p_actor_id uuid,
  p_organization_id uuid,
  p_kind text,
  p_expected_storage_path text,
  p_expected_following_storage_path text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_attempt_key uuid
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_old public.company_document_profiles;
  v_old_json jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_change record;
begin
  v_old := app_private.lock_company_document_profile(p_organization_id, p_actor_id);
  if p_kind is null or p_kind not in ('logo', 'stationery_first', 'stationery_following')
    or p_attempt_key is null
  then
    raise exception 'invalid_input';
  end if;
  if exists (
    select 1 from public.company_document_profile_events event
    where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key
      and event.actor_id = p_actor_id and event.field = p_kind and event.profile_version is null
  ) then
    return;
  end if;
  v_old_json := to_jsonb(v_old);
  if (v_old_json ->> (p_kind || '_storage_path')) is distinct from p_expected_storage_path
    or (p_kind = 'stationery_first' and p_storage_path is null
      and v_old.stationery_following_storage_path is distinct from p_expected_following_storage_path)
  then
    raise exception 'file_changed';
  end if;
  if p_kind = 'stationery_following' and p_storage_path is not null
    and v_old.stationery_first_storage_path is null
  then
    raise exception 'stationery_first_missing';
  end if;

  v_changes := jsonb_build_object(p_kind, jsonb_build_array(p_storage_path, p_mime_type, p_size_bytes));
  if p_kind = 'stationery_first' and p_storage_path is null then
    v_changes := v_changes || jsonb_build_object('stationery_following', jsonb_build_array(null, null, null));
  end if;

  for v_change in
    select kind, changes.value ->> 0 as storage_path, changes.value ->> 1 as mime_type,
      (changes.value ->> 2)::bigint as size_bytes,
      v_old_json ->> (kind || '_storage_path') as old_path
    from jsonb_each(v_changes) as changes(kind, value)
    -- The following pages first, so a removal never leaves them without a first page.
    order by kind desc
  loop
    continue when v_change.old_path is not distinct from v_change.storage_path;
    insert into public.company_document_profile_events (
      organization_id, field, old_value, new_value, actor_id, attempt_key
    )
    values (p_organization_id, v_change.kind, v_change.old_path, v_change.storage_path, p_actor_id, p_attempt_key);
    if v_change.old_path is not null then
      perform public.queue_storage_purge(p_organization_id, array[v_change.old_path]);
    end if;
    update public.company_document_profiles profile set
      logo_storage_path = case when v_change.kind = 'logo' then v_change.storage_path else profile.logo_storage_path end,
      logo_mime_type = case when v_change.kind = 'logo' then v_change.mime_type else profile.logo_mime_type end,
      logo_size_bytes = case when v_change.kind = 'logo' then v_change.size_bytes else profile.logo_size_bytes end,
      stationery_first_storage_path = case when v_change.kind = 'stationery_first'
        then v_change.storage_path else profile.stationery_first_storage_path end,
      stationery_first_mime_type = case when v_change.kind = 'stationery_first'
        then v_change.mime_type else profile.stationery_first_mime_type end,
      stationery_first_size_bytes = case when v_change.kind = 'stationery_first'
        then v_change.size_bytes else profile.stationery_first_size_bytes end,
      stationery_following_storage_path = case when v_change.kind = 'stationery_following'
        then v_change.storage_path else profile.stationery_following_storage_path end,
      stationery_following_mime_type = case when v_change.kind = 'stationery_following'
        then v_change.mime_type else profile.stationery_following_mime_type end,
      stationery_following_size_bytes = case when v_change.kind = 'stationery_following'
        then v_change.size_bytes else profile.stationery_following_size_bytes end,
      updated_at = now(), updated_by = p_actor_id
    where profile.organization_id = p_organization_id;
  end loop;
end;
$$;

revoke all on function public.replace_company_document_file(uuid, uuid, text, text, text, text, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.replace_company_document_file(uuid, uuid, text, text, text, text, text, bigint, uuid) to service_role;

-- The organization export holds the profile's files too: they are stored
-- originals of the organization, and its data part names their keys. A
-- profile file belongs to no document, so its plan row names none.
alter table public.organization_export_files alter column document_id drop not null;

-- As in 20261118090001_export_the_whole_organization.sql, plus the
-- organization's logo and stationery, with their sizes as stored.
create or replace function app_private.organization_export_sources(p_organization_id uuid)
returns table (source_path text, document_id uuid, version_number integer, file_bytes bigint)
language sql
stable
set search_path to ''
as $$
  select distinct on (source.source_path) source.source_path, source.document_id,
    source.version_number, source.file_bytes
  from (
    select document.storage_path as source_path, document.id as document_id,
      null::integer as version_number, document.size_bytes::bigint as file_bytes
    from public.documents document
    where document.organization_id = p_organization_id
    union all
    select version.storage_path, version.document_id, version.version_number, version.size_bytes::bigint
    from public.document_versions version
    where version.organization_id = p_organization_id
    union all
    select profile_file.storage_path, null::uuid, null::integer, profile_file.size_bytes
    from public.company_document_profiles profile
    cross join lateral (values
      (profile.logo_storage_path, profile.logo_size_bytes),
      (profile.stationery_first_storage_path, profile.stationery_first_size_bytes),
      (profile.stationery_following_storage_path, profile.stationery_following_size_bytes)
    ) as profile_file(storage_path, size_bytes)
    where profile.organization_id = p_organization_id and profile_file.storage_path is not null
  ) source
  order by source.source_path, source.version_number nulls first;
$$;
